import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  bindingSchema,
  identifier,
  manageSchema,
  toolName,
} from "./manifest.js";
import {
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
  if (raw.version !== 1) return [agentSchema.parse(raw)];
  const binding = bindingSchema.parse(raw),
    credentials = localCredentialsSchema.parse(
      JSON.parse(readPrivate(credentialsPath ?? path + ".credentials.json")),
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
const loginSchema = z
  .object({
    server_url: z.string().url(),
    account_id: identifier,
    login_key: z.string().min(32).max(256),
  })
  .strict();
export type AccountOptions = {
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
    signal: AbortSignal.timeout(30000),
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
    !["bootstrap", "manage", "claim", "device-import", "config-check"].includes(
      command,
    )
  )
    return false;
  if (command === "config-check") {
    if (!o.config) throw Error("--config required");
    loadAgents(resolve(o.config), o.credentials);
    console.log("Binding and local credential are valid");
    return true;
  }
  if (command === "device-import") {
    if (!o.bundle || !o.config || !o.workspace)
      throw Error(
        "device-import requires --bundle download.json --config binding.json --workspace path",
      );
    const path = resolve(o.config),
      cp = resolve(o.credentials ?? path + ".credentials.json");
    if (path === cp || existsSync(path) || existsSync(cp))
      throw Error("Choose new and separate binding and credential paths");
    const bundle = JSON.parse(readPrivate(resolve(o.bundle))),
      binding = bindingSchema.parse(bundle.binding);
    if (
      typeof bundle.device_key !== "string" ||
      hash(bundle.device_key) !== binding.device_key_sha256
    )
      throw Error("Invalid device bundle");
    const tools = binding.tools.filter(
      (t) => o.unrestricted || ["read", "ls", "find", "grep"].includes(t),
    );
    const local = localCredentialsSchema.parse({
      device_key: bundle.device_key,
      local: {
        workspace: resolve(o.workspace),
        access: o.unrestricted ? "unrestricted" : "workspace",
        tools,
      },
    });
    savePrivate(cp, json(local));
    savePrivate(path, json(binding));
    console.log(`Binding: ${path}\nPrivate local settings: ${cp}`);
    return true;
  }
  if (command === "bootstrap") {
    if (!o.url || !o.account || !o["key-file"] || !o.out)
      throw Error("bootstrap requires --url --account --key-file --out");
    if (existsSync(resolve(o.out))) throw Error("Output already exists");
    const result = await post(
      o.url,
      "/bootstrap",
      { account_id: o.account, name: o.name ?? o.account },
      { Authorization: "Bearer " + readPrivate(resolve(o["key-file"])).trim() },
    );
    savePrivate(resolve(o.out), json(loginSchema.parse(result)));
    console.log(`Administrator login saved privately: ${resolve(o.out)}`);
    return true;
  }
  if (command === "claim") {
    if (!o.url || !o.out) throw Error("claim requires --url claim-link --out");
    if (existsSync(resolve(o.out))) throw Error("Output already exists");
    const url = new URL(o.url);
    if (url.pathname !== "/claim" || !url.hash)
      throw Error("Invalid claim URL");
    const result = await post(url.origin, "/claim", {
      code: url.hash.slice(1),
    });
    savePrivate(resolve(o.out), json(result));
    console.log(`Credentials saved privately: ${resolve(o.out)}`);
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
    confirmation_id: o.confirmation,
  });
  const result = await post(login.server_url, "/api/manage", request, {
    Authorization: "Bearer " + login.login_key,
    "X-Account-Id": login.account_id,
  });
  console.log(json(result));
  return true;
}
