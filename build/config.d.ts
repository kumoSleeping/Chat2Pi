import { z } from "zod";
export declare const toolNames: readonly ["read", "write", "edit", "ls", "find", "grep", "bash"];
export declare const deviceId: z.ZodString;
export declare const DEFAULT_MAX_CONCURRENT = 16;
export declare const maxConcurrentSchema: z.ZodDefault<z.ZodNumber>;
export declare const deviceSchema: z.ZodEffects<z.ZodObject<{
    device_id: z.ZodString;
    workspace: z.ZodString;
    tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
    access: z.ZodDefault<z.ZodEnum<["workspace", "unrestricted"]>>;
    timeout_seconds: z.ZodDefault<z.ZodNumber>;
    max_concurrent: z.ZodDefault<z.ZodNumber>;
    shell_path: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    device_id: string;
    workspace: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    access: "workspace" | "unrestricted";
    timeout_seconds: number;
    max_concurrent: number;
    shell_path?: string | undefined;
}, {
    device_id: string;
    workspace: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    access?: "workspace" | "unrestricted" | undefined;
    timeout_seconds?: number | undefined;
    max_concurrent?: number | undefined;
    shell_path?: string | undefined;
}>, {
    device_id: string;
    workspace: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    access: "workspace" | "unrestricted";
    timeout_seconds: number;
    max_concurrent: number;
    shell_path?: string | undefined;
}, {
    device_id: string;
    workspace: string;
    tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
    access?: "workspace" | "unrestricted" | undefined;
    timeout_seconds?: number | undefined;
    max_concurrent?: number | undefined;
    shell_path?: string | undefined;
}>;
export declare const agentSchema: z.ZodObject<{
    gateway_url: z.ZodString;
    device_token: z.ZodString;
    proxy_url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    device: z.ZodEffects<z.ZodObject<{
        device_id: z.ZodString;
        workspace: z.ZodString;
        tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
        access: z.ZodDefault<z.ZodEnum<["workspace", "unrestricted"]>>;
        timeout_seconds: z.ZodDefault<z.ZodNumber>;
        max_concurrent: z.ZodDefault<z.ZodNumber>;
        shell_path: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>;
    account_id: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    gateway_url: string;
    device_token: string;
    device: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
    account_id?: string | undefined;
}, {
    gateway_url: string;
    device_token: string;
    device: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
    account_id?: string | undefined;
}>;
export declare const gatewaySchema: z.ZodEffects<z.ZodObject<{
    public_url: z.ZodString;
    port: z.ZodDefault<z.ZodNumber>;
    owner_key_file: z.ZodString;
    oauth_state_file: z.ZodString;
    local_device: z.ZodOptional<z.ZodEffects<z.ZodObject<{
        device_id: z.ZodString;
        workspace: z.ZodString;
        tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
        access: z.ZodDefault<z.ZodEnum<["workspace", "unrestricted"]>>;
        timeout_seconds: z.ZodDefault<z.ZodNumber>;
        max_concurrent: z.ZodDefault<z.ZodNumber>;
        shell_path: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>>;
    devices: z.ZodDefault<z.ZodArray<z.ZodObject<{
        device_id: z.ZodString;
        token: z.ZodString;
        tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
    }, "strict", z.ZodTypeAny, {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }, {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }>, "many">>;
    cloudflare_config: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    public_url: string;
    port: number;
    owner_key_file: string;
    oauth_state_file: string;
    devices: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }[];
    local_device?: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    } | undefined;
    cloudflare_config?: string | undefined;
}, {
    public_url: string;
    owner_key_file: string;
    oauth_state_file: string;
    port?: number | undefined;
    local_device?: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    } | undefined;
    devices?: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }[] | undefined;
    cloudflare_config?: string | undefined;
}>, {
    public_url: string;
    port: number;
    owner_key_file: string;
    oauth_state_file: string;
    devices: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }[];
    local_device?: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    } | undefined;
    cloudflare_config?: string | undefined;
}, {
    public_url: string;
    owner_key_file: string;
    oauth_state_file: string;
    port?: number | undefined;
    local_device?: {
        device_id: string;
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access?: "workspace" | "unrestricted" | undefined;
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    } | undefined;
    devices?: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        token: string;
    }[] | undefined;
    cloudflare_config?: string | undefined;
}>;
export type Device = z.infer<typeof deviceSchema>;
export type GatewayConfig = z.infer<typeof gatewaySchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export declare function readConfig(path: string): unknown;
export declare function secureEqual(a: string, b: string): boolean;
export declare function token(): string;
export declare function savePrivate(path: string, value: string): void;
export declare function readPrivate(path: string): string;
export declare function requireSecureUrl(value: string): URL;
