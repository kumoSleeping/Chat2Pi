import { createHash } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { resolve, join } from "node:path";
import { homeDirectory, loginPath, selectLogin } from "./home-store.js";
import { z } from "zod";
import { bindingSchema, identifier, manageSchema, toolName, } from "./manifest.js";
import { token, agentSchema, readPrivate, savePrivate, requireSecureUrl, } from "./config.js";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const localCredentialsSchema = z
    .object({
    device_key: z.string().min(32).max(256),
    proxy_url: agentSchema.shape.proxy_url,
    local: z
        .object({
        workspace: z.string().min(1),
        access: z.enum(["workspace", "unrestricted"]),
        tools: z.array(toolName).min(1),
        timeout_seconds: z.number().int().min(1).max(300).default(60),
        shell_path: z.string().optional(),
    })
        .strict(),
})
    .strict();
export function loadAgents(path, credentialsPath) {
    const raw = JSON.parse(readPrivate(path));
    if (!raw.binding && raw.version !== 1)
        return [agentSchema.parse(raw)];
    const bundle = raw.binding ? deviceBundleSchema.parse(raw) : undefined;
    const binding = bundle?.binding ?? bindingSchema.parse(raw), credentials = localCredentialsSchema.parse(bundle
        ? {
            device_key: bundle.device_key,
            local: bundle.local,
            proxy_url: bundle.proxy_url,
        }
        : JSON.parse(readPrivate(credentialsPath ?? path + ".credentials.json")));
    if (hash(credentials.device_key) !== binding.device_key_sha256)
        throw Error("Device credential does not match binding");
    const tools = credentials.local.tools.filter((t) => binding.tools.includes(t));
    if (!tools.length)
        throw Error("No permitted tools");
    return [
        agentSchema.parse({
            gateway_url: binding.server_url,
            account_id: binding.account_id,
            device_token: credentials.device_key,
            proxy_url: credentials.proxy_url,
            device: { ...credentials.local, device_id: binding.device_id, tools },
        }),
    ];
}
export const deviceBundleSchema = z
    .object({
    binding: bindingSchema,
    device_key: z.string().min(32).max(256),
    access: z.enum(["read", "workspace", "full"]).optional(),
    local: localCredentialsSchema.shape.local.optional(),
    proxy_url: localCredentialsSchema.shape.proxy_url,
})
    .strict();
export const loginSchema = z
    .object({
    server_url: z.string().url(),
    account_id: identifier,
    login_key: z.string().min(32).max(256),
})
    .strict();
export function prepareDeviceBundle(raw, o = {}) {
    const bundle = deviceBundleSchema.parse(raw), binding = bundle.binding;
    if (typeof bundle.device_key !== "string" ||
        hash(bundle.device_key) !== binding.device_key_sha256)
        throw Error("Invalid device bundle");
    const access = z
        .enum(["read", "workspace", "full"])
        .parse(o.access ??
        (o.unrestricted
            ? "full"
            : (bundle.access ??
                (bundle.local
                    ? bundle.local.access === "unrestricted"
                        ? "full"
                        : "workspace"
                    : "full"))));
    const tools = binding.tools.filter((t) => (!bundle.local || bundle.local.tools.includes(t)) &&
        (access === "full" ||
            (access === "workspace"
                ? t !== "bash"
                : ["read", "ls", "find", "grep"].includes(t))));
    const workspace = resolve(o.workspace ?? bundle.local?.workspace ?? join(homedir(), "PiWorkspace"));
    const local = localCredentialsSchema.parse({
        device_key: bundle.device_key,
        proxy_url: bundle.proxy_url,
        local: {
            ...bundle.local,
            workspace,
            access: access === "full" ? "unrestricted" : "workspace",
            tools,
        },
    });
    // Validate the effective policy before writing anything or connecting.
    agentSchema.parse({
        gateway_url: binding.server_url,
        account_id: binding.account_id,
        device_token: local.device_key,
        proxy_url: local.proxy_url,
        device: { ...local.local, device_id: binding.device_id },
    });
    return { binding, ...local };
}
const json = (v) => JSON.stringify(v, null, 2) + "\n";
async function post(origin, path, body, headers = {}) {
    const base = requireSecureUrl(origin).origin;
    const response = await fetch(base + path, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json", Origin: base, ...headers },
        body: json(body),
        signal: AbortSignal.timeout(path === "/api/call" ? 320000 : 30000),
    });
    if (!response.ok)
        throw Error(`Service request failed (${response.status}): ${await response.text()}`);
    return (await response.json());
}
export async function accountCommand(command, o) {
    if (!["bootstrap", "manage", "device-create"].includes(command))
        return false;
    const home = homeDirectory(o.home);
    if (["manage", "call", "device-create"].includes(command) && !o.credentials)
        o = { ...o, credentials: selectLogin(home, o.account, o.url) };
    if (command === "device-create") {
        const id = identifier.parse(o.id);
        const access = z
            .enum(["read", "workspace", "full"])
            .parse(o.access ?? "full");
        const tools = access === "full"
            ? [...toolName.options]
            : access === "workspace"
                ? toolName.options.filter((t) => t !== "bash")
                : ["read", "ls", "find", "grep"];
        const login = loginSchema.parse(JSON.parse(readPrivate(resolve(o.credentials))));
        const output = resolve(o.out ?? join(homedir(), "Downloads", id + ".json"));
        let bundle;
        if (existsSync(output)) {
            bundle = deviceBundleSchema.parse(JSON.parse(readPrivate(output)));
            const b = bindingSchema.parse(bundle.binding);
            if (typeof bundle.device_key !== "string" ||
                hash(bundle.device_key) !== b.device_key_sha256 ||
                b.server_url !== login.server_url ||
                b.account_id !== login.account_id ||
                b.device_id !== id ||
                bundle.access !== access ||
                JSON.stringify(b.tools) !== JSON.stringify(tools) ||
                b.device_name !== (o.name ?? id))
                throw Error("Output contains a different device or access mode; choose another --out path");
        }
        else {
            const deviceKey = token();
            bundle = {
                binding: bindingSchema.parse({
                    version: 1,
                    server_url: login.server_url,
                    account_id: login.account_id,
                    device_id: id,
                    device_name: o.name ?? id,
                    device_key_sha256: hash(deviceKey),
                    tools,
                }),
                device_key: deviceKey,
                access,
            };
            // Persist the only copy of the secret before making any remote change.
            mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
            const fd = openSync(output, "wx", 0o600);
            try {
                writeFileSync(fd, json(bundle));
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
        }
        try {
            const result = await post(login.server_url, "/api/manage", {
                action: "bind_device",
                device_id: id,
                name: bundle.binding.device_name,
                tools: bundle.binding.tools,
                device_key_sha256: bundle.binding.device_key_sha256,
            }, {
                Authorization: "Bearer " + login.login_key,
                "X-Account-Id": login.account_id,
            });
            if (JSON.stringify(bindingSchema.parse(result.binding)) !==
                JSON.stringify(bundle.binding) ||
                result.claim_url)
                throw Error("Server does not support local device creation; update the server first");
        }
        catch (error) {
            throw Error(`Device file preserved at ${output}. Registration is not confirmed; retry the same command after resolving the error. ${error instanceof Error ? error.message : "Request failed"}`);
        }
        console.log(`Device file ready: ${id}\nAccess: ${access}\nFile: ${output}\nOn the target computer, run chat2pi folder, drop this file into the opened folder, then run chat2pi start.`);
        return true;
    }
    if (command === "bootstrap") {
        if (!o.url || !o.account || !o["key-file"])
            throw Error("bootstrap requires --url --account --key-file");
        const output = o.out ? resolve(o.out) : loginPath(home, o.url, o.account);
        if (existsSync(output))
            throw Error("Output already exists");
        const result = await post(o.url, "/bootstrap", { account_id: o.account, name: o.name ?? o.account }, { Authorization: "Bearer " + readPrivate(resolve(o["key-file"])).trim() });
        savePrivate(output, json(loginSchema.parse(result)));
        console.log(`Administrator login saved privately: ${output}`);
        return true;
    }
    if (!o.credentials || !o.action)
        throw Error("manage requires --credentials account-login.json --action");
    const login = loginSchema.parse(JSON.parse(readPrivate(resolve(o.credentials))));
    const request = manageSchema.parse({
        action: o.action,
        account_id: o.target,
        device_id: o.id,
        name: o.name,
        role: o.role,
        tools: o.tools?.split(",").map((t) => t.trim()),
        confirmation_id: o.confirmation,
    });
    const result = await post(login.server_url, "/api/manage", request, {
        Authorization: "Bearer " + login.login_key,
        "X-Account-Id": login.account_id,
    });
    console.log(json(result));
    return true;
}
