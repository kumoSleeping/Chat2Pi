import { z } from "zod";
export declare const identifier: z.ZodString;
export declare const toolName: z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>;
export declare const bindingSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    server_url: z.ZodEffects<z.ZodString, string, string>;
    account_id: z.ZodString;
    device_id: z.ZodString;
    device_name: z.ZodString;
    device_key_sha256: z.ZodString;
    tools: z.ZodEffects<z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">, ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[], ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[]>;
}, "strict", z.ZodTypeAny, {
    device_id: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    account_id: string;
    version: 1;
    server_url: string;
    device_name: string;
    device_key_sha256: string;
}, {
    device_id: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    account_id: string;
    version: 1;
    server_url: string;
    device_name: string;
    device_key_sha256: string;
}>;
export type Binding = z.infer<typeof bindingSchema>;
export declare const manageSchema: z.ZodObject<{
    action: z.ZodEnum<["me", "list_accounts", "create_account", "disable_account", "enable_account", "set_role", "list_devices", "bind_device", "unbind_device", "reissue_device", "rotate_login"]>;
    account_id: z.ZodOptional<z.ZodString>;
    device_id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodEnum<["admin", "member"]>>;
    tools: z.ZodOptional<z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">>;
    device_key_sha256: z.ZodOptional<z.ZodString>;
    confirmation_id: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    action: "me" | "list_accounts" | "create_account" | "disable_account" | "enable_account" | "set_role" | "list_devices" | "bind_device" | "unbind_device" | "reissue_device" | "rotate_login";
    device_id?: string | undefined;
    tools?: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[] | undefined;
    account_id?: string | undefined;
    device_key_sha256?: string | undefined;
    name?: string | undefined;
    role?: "admin" | "member" | undefined;
    confirmation_id?: string | undefined;
}, {
    action: "me" | "list_accounts" | "create_account" | "disable_account" | "enable_account" | "set_role" | "list_devices" | "bind_device" | "unbind_device" | "reissue_device" | "rotate_login";
    device_id?: string | undefined;
    tools?: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[] | undefined;
    account_id?: string | undefined;
    device_key_sha256?: string | undefined;
    name?: string | undefined;
    role?: "admin" | "member" | undefined;
    confirmation_id?: string | undefined;
}>;
export type Manage = z.infer<typeof manageSchema>;
export declare const manageTool: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            action: {
                type: string;
                enum: ["me", "list_accounts", "create_account", "disable_account", "enable_account", "set_role", "list_devices", "bind_device", "unbind_device", "reissue_device", "rotate_login"];
            };
            account_id: {
                type: string;
            };
            device_id: {
                type: string;
            };
            name: {
                type: string;
            };
            role: {
                type: string;
                enum: string[];
            };
            tools: {
                type: string;
                items: {
                    type: string;
                    enum: ["read", "write", "edit", "ls", "find", "grep", "bash"];
                };
            };
            device_key_sha256: {
                type: string;
                description: string;
            };
            confirmation_id: {
                type: string;
                description: string;
            };
        };
        required: string[];
        additionalProperties: boolean;
    };
    annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: boolean;
    };
};
export declare const directCallSchema: z.ZodObject<{
    device_id: z.ZodString;
    name: z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>;
    arguments: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strict", z.ZodTypeAny, {
    device_id: string;
    name: "read" | "write" | "edit" | "ls" | "find" | "grep" | "bash";
    arguments: Record<string, unknown>;
}, {
    device_id: string;
    name: "read" | "write" | "edit" | "ls" | "find" | "grep" | "bash";
    arguments?: Record<string, unknown> | undefined;
}>;
