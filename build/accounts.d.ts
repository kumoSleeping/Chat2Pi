import { z } from "zod";
import { type AgentConfig } from "./config.js";
export declare const hash: (value: string) => string;
export declare const localCredentialsSchema: z.ZodObject<{
    device_key: z.ZodString;
    proxy_url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    local: z.ZodObject<{
        workspace: z.ZodString;
        access: z.ZodEnum<["workspace", "unrestricted"]>;
        tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
        timeout_seconds: z.ZodDefault<z.ZodNumber>;
        max_concurrent: z.ZodDefault<z.ZodNumber>;
        shell_path: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    device_key: string;
    local: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
}, {
    device_key: string;
    local: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
}>;
export declare function loadAgents(path: string, credentialsPath?: string): AgentConfig[];
export declare const deviceBundleSchema: z.ZodObject<{
    binding: z.ZodObject<{
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
    device_key: z.ZodString;
    access: z.ZodOptional<z.ZodEnum<["read", "workspace", "full"]>>;
    local: z.ZodOptional<z.ZodObject<{
        workspace: z.ZodString;
        access: z.ZodEnum<["workspace", "unrestricted"]>;
        tools: z.ZodArray<z.ZodEnum<["read", "write", "edit", "ls", "find", "grep", "bash"]>, "many">;
        timeout_seconds: z.ZodDefault<z.ZodNumber>;
        max_concurrent: z.ZodDefault<z.ZodNumber>;
        shell_path: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    }, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    }>>;
    proxy_url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    device_key: string;
    binding: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        account_id: string;
        version: 1;
        server_url: string;
        device_name: string;
        device_key_sha256: string;
    };
    access?: "read" | "workspace" | "full" | undefined;
    proxy_url?: string | undefined;
    local?: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    } | undefined;
}, {
    device_key: string;
    binding: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        account_id: string;
        version: 1;
        server_url: string;
        device_name: string;
        device_key_sha256: string;
    };
    access?: "read" | "workspace" | "full" | undefined;
    proxy_url?: string | undefined;
    local?: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds?: number | undefined;
        max_concurrent?: number | undefined;
        shell_path?: string | undefined;
    } | undefined;
}>;
export declare const loginSchema: z.ZodObject<{
    server_url: z.ZodString;
    account_id: z.ZodString;
    login_key: z.ZodString;
}, "strict", z.ZodTypeAny, {
    account_id: string;
    server_url: string;
    login_key: string;
}, {
    account_id: string;
    server_url: string;
    login_key: string;
}>;
export type AccountOptions = {
    home?: string;
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
    access?: string;
    tools?: string;
};
export declare function prepareDeviceBundle(raw: unknown, o?: Pick<AccountOptions, "workspace" | "access" | "unrestricted">): {
    device_key: string;
    local: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        max_concurrent: number;
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
    binding: {
        device_id: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        account_id: string;
        version: 1;
        server_url: string;
        device_name: string;
        device_key_sha256: string;
    };
};
export declare function accountCommand(command: string, o: AccountOptions): Promise<boolean>;
