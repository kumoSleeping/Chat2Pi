import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  existsSync,
  renameSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const toolNames = [
  "read",
  "write",
  "edit",
  "ls",
  "find",
  "grep",
  "bash",
] as const;
export const deviceId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const secret = z.string().min(32).max(256);
export const DEFAULT_MAX_CONCURRENT = 16;
export const maxConcurrentSchema = z
  .number()
  .int()
  .safe()
  .min(1)
  .default(DEFAULT_MAX_CONCURRENT);
export const deviceSchema = z
  .object({
    device_id: deviceId,
    workspace: z.string(),
    tools: z.array(z.enum(toolNames)).min(1),
    // Workspace mode checks file paths and does not permit arbitrary shell commands.
    access: z.enum(["workspace", "unrestricted"]).default("workspace"),
    timeout_seconds: z.number().int().min(1).max(300).default(300),
    max_concurrent: maxConcurrentSchema,
    shell_path: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (d) => d.access !== "workspace" || !d.tools.includes("bash"),
    "bash requires access=unrestricted; a working directory is not a shell sandbox",
  );
export const agentSchema = z
  .object({
    gateway_url: z.string().url(),
    device_token: secret,
    proxy_url: z
      .string()
      .url()
      .refine((value) => {
        const u = new URL(value);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash
        );
      }, "proxy_url must be an HTTP(S) proxy origin")
      .optional(),
    device: deviceSchema,
    account_id: deviceId.optional(),
  })
  .strict();
export const gatewaySchema = z
  .object({
    public_url: z.string().url(),
    port: z.number().int().min(1024).max(65535).default(8787),
    owner_key_file: z.string(),
    oauth_state_file: z.string(),
    local_device: deviceSchema.optional(),
    devices: z
      .array(
        z
          .object({
            device_id: deviceId,
            token: secret,
            tools: z.array(z.enum(toolNames)).min(1),
          })
          .strict(),
      )
      .default([]),
    cloudflare_config: z.string().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = [
      ...c.devices.map((d) => d.device_id),
      ...(c.local_device ? [c.local_device.device_id] : []),
    ];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate device IDs" });
    if (new Set(c.devices.map((d) => d.token)).size !== c.devices.length)
      ctx.addIssue({
        code: "custom",
        message: "Each device needs a unique token",
      });
  });
export type Device = z.infer<typeof deviceSchema>;
export type GatewayConfig = z.infer<typeof gatewaySchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export function readConfig(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}
export function secureEqual(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function token(): string {
  return randomBytes(32).toString("base64url");
}
export function savePrivate(path: string, value: string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  if (
    existsSync(path) &&
    process.platform !== "win32" &&
    statSync(path).mode & 0o077
  )
    throw new Error(`Secret file must have mode 0600: ${path}`);
  const pending = path + "." + token() + ".tmp";
  writeFileSync(pending, value, { mode: 0o600, flag: "wx" });
  renameSync(pending, path);
}
export function readPrivate(path: string): string {
  if (process.platform !== "win32" && statSync(path).mode & 0o077)
    throw new Error(`Secret file must have mode 0600: ${path}`);
  return readFileSync(path, "utf8").trim();
}
export function requireSecureUrl(value: string): URL {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
    throw new Error("Gateway URL must be an origin");
  if (
    u.protocol !== "https:" &&
    !(u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname))
  )
    throw new Error("HTTPS required except on localhost");
  return u;
}
