import { z } from "zod";
export const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
export const toolName = z.enum([
  "read",
  "write",
  "edit",
  "ls",
  "find",
  "grep",
  "bash",
]);
export const bindingSchema = z
  .object({
    version: z.literal(1),
    server_url: z
      .string()
      .url()
      .refine((value) => {
        const u = new URL(value);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          u.pathname === "/"
        );
      }, "Expected an HTTPS origin"),
    account_id: identifier,
    device_id: identifier,
    device_name: z.string().min(1).max(100),
    device_key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    tools: z
      .array(toolName)
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export type Binding = z.infer<typeof bindingSchema>;
export const manageSchema = z
  .object({
    action: z.enum([
      "me",
      "list_accounts",
      "create_account",
      "disable_account",
      "enable_account",
      "set_role",
      "list_devices",
      "bind_device",
      "unbind_device",
      "rotate_login",
    ]),
    account_id: identifier.optional(),
    device_id: identifier.optional(),
    name: z.string().min(1).max(100).optional(),
    role: z.enum(["admin", "member"]).optional(),
    tools: z.array(toolName).min(1).max(7).optional(),
    confirmation_id: z.string().uuid().optional(),
  })
  .strict();
export type Manage = z.infer<typeof manageSchema>;
export const manageTool = {
  name: "manage",
  description: "管理账号和设备。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: manageSchema.shape.action.options },
      account_id: { type: "string" },
      device_id: { type: "string" },
      name: { type: "string" },
      role: { type: "string", enum: ["admin", "member"] },
      tools: {
        type: "array",
        items: { type: "string", enum: toolName.options },
      },
      confirmation_id: { type: "string", description: "用户确认后提交。" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};
