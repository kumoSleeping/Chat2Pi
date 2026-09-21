import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  homeDirectory,
  loginPath,
  bindingPath,
  selectLogin,
} from "./home-store.js";
import { z } from "zod";
import {
  bindingSchema,
  directCallSchema,
  identifier,
  manageSchema,
  toolName,
} from "./manifest.js";
import {
  token,
  agentSchema,
  readPrivate,
  savePrivate,
  requireSecureUrl,
  type AgentConfig,
} from "./config.js";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
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
export function loadAgents(
  path: string,
  credentialsPath?: string,
): AgentConfig[] {
  const raw = JSON.parse(readPrivate(path));
  if (!raw.binding && raw.version !== 1) return [agentSchema.parse(raw)];
  const bundle = raw.binding ? deviceBundleSchema.parse(raw) : undefined;
  const binding = bundle?.binding ?? bindingSchema.parse(raw),
    credentials = localCredentialsSchema.parse(
      bundle
        ? {
            device_key: bundle.device_key,
            local: bundle.local,
            proxy_url: bundle.proxy_url,
          }
        : JSON.parse(
            readPrivate(credentialsPath ?? path + ".credentials.json"),
          ),
    );
  if (hash(credentials.device_key) !== binding.device_key_sha256)
    throw Error("Device credential does not match binding");
  const tools = credentials.local.tools.filter((t) =>
    binding.tools.includes(t),
  );
  if (!tools.length) throw Error("No permitted tools");
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
export type AccountOptions = {
  home?: string;
  config?: string;
  url?: string;
  account?: string;
  name?: string;
  id?: string;
  workspace?: string;
  out?: string;
  credentials?: string;
  unrestricted?: boolean;
  action?: string;
  target?: string;
  role?: string;
  confirmation?: string;
  "key-file"?: string;
  bundle?: string;
  tool?: string;
  args?: string;
  access?: string;
  tools?: string;
  start?: boolean;
  background?: boolean;
};
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
async function post(
  origin: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const base = requireSecureUrl(origin).origin;
  const response = await fetch(base + path, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: json(body),
    signal: AbortSignal.timeout(path === "/api/call" ? 320000 : 30000),
  });
  if (!response.ok)
    throw Error(
      `Service request failed (${response.status}): ${await response.text()}`,
    );
  return (await response.json()) as any;
}
export async function accountCommand(
  command: string,
  o: AccountOptions,
): Promise<boolean> {
  if (
    ![
      "login-import",
      "bootstrap",
      "manage",
      "call",
      "claim",
      "device-import",
      "device-create",
      "config-check",
    ].includes(command)
  )
    return false;
  const home = homeDirectory(o.home);
  if (["login-import", "device-import"].includes(command)) {
    const { migrateHome } = await import("./migration.js");
    migrateHome(home);
  }
  if (command === "login-import") {
    if (!o.bundle) throw Error("login-import requires --bundle login.json");
    const raw = JSON.parse(readPrivate(resolve(o.bundle)));
    if (raw.binding || raw.device_key)
      throw Error(
        "This is a device file; use device-import on the target computer",
      );
    const login = loginSchema.parse(raw);
    const path = loginPath(home, login.server_url, login.account_id);
    if (existsSync(path))
      throw Error("Account credential already exists; not overwritten");
    savePrivate(path, json(login));
    console.log(`Account credential saved privately: ${path}`);
    return true;
  }
  if (["manage", "call", "device-create"].includes(command) && !o.credentials)
    o = { ...o, credentials: selectLogin(home, o.account, o.url) };
  if (command === "device-create") {
    const id = identifier.parse(o.id);
    const access = z
      .enum(["read", "workspace", "full"])
      .parse(o.access ?? "full");
    const tools =
      access === "full"
        ? [...toolName.options]
        : access === "workspace"
          ? toolName.options.filter((t) => t !== "bash")
          : ["read", "ls", "find", "grep"];
    const login = loginSchema.parse(
      JSON.parse(readPrivate(resolve(o.credentials!))),
    );
    const output = resolve(o.out ?? join(homedir(), "Downloads", id + ".json"));
    let bundle: any;
    if (existsSync(output)) {
      bundle = deviceBundleSchema.parse(JSON.parse(readPrivate(output)));
      const b = bindingSchema.parse(bundle.binding);
      if (
        typeof bundle.device_key !== "string" ||
        hash(bundle.device_key) !== b.device_key_sha256 ||
        b.server_url !== login.server_url ||
        b.account_id !== login.account_id ||
        b.device_id !== id ||
        bundle.access !== access ||
        JSON.stringify(b.tools) !== JSON.stringify(tools) ||
        b.device_name !== (o.name ?? id)
      )
        throw Error(
          "Output contains a different device or access mode; choose another --out path",
        );
    } else {
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
      } finally {
        closeSync(fd);
      }
    }
    try {
      const result = await post(
        login.server_url,
        "/api/manage",
        {
          action: "bind_device",
          device_id: id,
          name: bundle.binding.device_name,
          tools: bundle.binding.tools,
          device_key_sha256: bundle.binding.device_key_sha256,
        },
        {
          Authorization: "Bearer " + login.login_key,
          "X-Account-Id": login.account_id,
        },
      );
      if (
        JSON.stringify(bindingSchema.parse(result.binding)) !==
          JSON.stringify(bundle.binding) ||
        result.claim_url
      )
        throw Error(
          "Server does not support local device creation; update the server first",
        );
    } catch (error) {
      throw Error(
        `Device file preserved at ${output}. Registration is not confirmed; retry the same command after resolving the error. ${error instanceof Error ? error.message : "Request failed"}`,
      );
    }
    console.log(
      `Device file ready: ${id}\nAccess: ${access}\nFile: ${output}\nTransfer this file to the target computer and run device-import --bundle <file>`,
    );
    return true;
  }
  if (command === "config-check") {
    if (!o.config) throw Error("--config required");
    loadAgents(resolve(o.config), o.credentials);
    console.log("Binding and local credential are valid");
    return true;
  }
  if (command === "device-import") {
    if (!o.bundle) throw Error("device-import requires --bundle download.json");
    if (o.start && (o.config || o.credentials))
      throw Error(
        "--start uses default binding paths; omit --config and --credentials",
      );
    const raw = JSON.parse(readPrivate(resolve(o.bundle)));
    if (raw.login_key)
      throw Error(
        "This is an account file for ChatGPT authorization; use a device file on this computer",
      );
    const bundle = deviceBundleSchema.parse(raw),
      binding = bundle.binding;
    const path = o.config
        ? resolve(o.config)
        : bindingPath(
            home,
            binding.server_url,
            binding.account_id,
            binding.device_id,
          ),
      cp = resolve(o.credentials ?? path + ".credentials.json");
    if (path === cp)
      throw Error("Choose separate binding and credential paths");
    if (
      typeof bundle.device_key !== "string" ||
      hash(bundle.device_key) !== binding.device_key_sha256
    )
      throw Error("Invalid device bundle");
    const access = z
      .enum(["read", "workspace", "full"])
      .parse(
        o.access ??
          (o.unrestricted
            ? "full"
            : (bundle.access ??
              (bundle.local
                ? bundle.local.access === "unrestricted"
                  ? "full"
                  : "workspace"
                : "full"))),
      );
    const tools = binding.tools.filter(
      (t) =>
        (!bundle.local || bundle.local.tools.includes(t)) &&
        (access === "full" ||
          (access === "workspace"
            ? t !== "bash"
            : ["read", "ls", "find", "grep"].includes(t))),
    );
    const workspace = resolve(
      o.workspace ?? bundle.local?.workspace ?? join(homedir(), "PiWorkspace"),
    );
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
    // Explicit legacy paths remain supported; managed storage uses one device file.
    const outputs: [string, unknown][] =
      o.config || o.credentials
        ? [
            [cp, local],
            [path, binding],
          ]
        : [[path, { binding, ...local }]];
    // Identical imports can resume a partial write or a failed service start.
    for (const [file, value] of outputs) {
      if (
        existsSync(file) &&
        json(JSON.parse(readPrivate(file))) !== json(value)
      )
        throw Error(
          "Existing local binding/settings differ; refusing to overwrite",
        );
    }
    mkdirSync(workspace, { recursive: true });
    for (const [file, value] of outputs)
      if (!existsSync(file)) savePrivate(file, json(value));
    console.log(
      `Device: ${binding.device_id}\nWorkspace: ${workspace}\nAccess: ${access}\nTools: ${tools.join(", ")}`,
    );
    if (o.start) {
      const { serviceCommand } = await import("./service.js");
      await serviceCommand(
        o.background ? "restart" : "start",
        home,
        o.background,
      );
    }
    return true;
  }
  if (command === "bootstrap") {
    if (!o.url || !o.account || !o["key-file"])
      throw Error("bootstrap requires --url --account --key-file");
    const output = o.out ? resolve(o.out) : loginPath(home, o.url!, o.account!);
    if (existsSync(output)) throw Error("Output already exists");
    const result = await post(
      o.url,
      "/bootstrap",
      { account_id: o.account, name: o.name ?? o.account },
      { Authorization: "Bearer " + readPrivate(resolve(o["key-file"])).trim() },
    );
    savePrivate(output, json(loginSchema.parse(result)));
    console.log(`Administrator login saved privately: ${output}`);
    return true;
  }
  if (command === "claim") {
    if (!o.url) throw Error("claim requires --url claim-link");
    let output = o.out ? resolve(o.out) : undefined;
    if (output && existsSync(output)) throw Error("Output already exists");
    const url = new URL(o.url);
    if (url.pathname !== "/claim" || !url.hash)
      throw Error("Invalid claim URL");
    const result = await post(url.origin, "/claim", {
      code: url.hash.slice(1),
    });
    const device = "binding" in result;
    const credentials = device
      ? deviceBundleSchema.parse(result)
      : loginSchema.parse(result);
    const filename = device
      ? result.binding.device_id + ".json"
      : "link_chatgpt_plugin_oauth_" + result.account_id + ".json";
    // A unique containing folder preserves both the requested filename and old downloads.
    output ??= join(home, "downloads", randomUUID(), filename);
    savePrivate(output, json(credentials));
    console.log(
      `${device ? "Device configuration" : "ChatGPT plugin account credentials"} saved privately: ${output}`,
    );
    return true;
  }
  if (command === "call") {
    if (!o.credentials || !o.id || !o.tool)
      throw Error("call requires --credentials --id --tool [--args JSON]");
    const login = loginSchema.parse(
      JSON.parse(readPrivate(resolve(o.credentials))),
    );
    const input = directCallSchema.parse({
      device_id: o.id,
      name: o.tool,
      arguments: JSON.parse(o.args ?? "{}"),
    });
    console.log(
      json(
        await post(login.server_url, "/api/call", input, {
          Authorization: "Bearer " + login.login_key,
          "X-Account-Id": login.account_id,
        }),
      ),
    );
    return true;
  }
  if (!o.credentials || !o.action)
    throw Error("manage requires --credentials account-login.json --action");
  const login = loginSchema.parse(
    JSON.parse(readPrivate(resolve(o.credentials))),
  );
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
