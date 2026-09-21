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
        shell_path: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
        shell_path?: string | undefined;
    }, {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds?: number | undefined;
        shell_path?: string | undefined;
    }>;
}, "strict", z.ZodTypeAny, {
    device_key: string;
    local: {
        workspace: string;
        tools: ("read" | "write" | "edit" | "ls" | "find" | "grep" | "bash")[];
        access: "workspace" | "unrestricted";
        timeout_seconds: number;
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
        shell_path?: string | undefined;
    };
    proxy_url?: string | undefined;
}>;
export declare function loadAgents(path: string, credentialsPath?: string): AgentConfig[];
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
};
export declare function accountCommand(command: string, o: AccountOptions): Promise<boolean>;
