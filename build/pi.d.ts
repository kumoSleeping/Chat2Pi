import { type Device } from "./config.js";
export declare const piVersion: string;
export declare function makeTools(workspace: string, shellPath?: string): Map<string, any>;
export declare function catalog(workspace: string): {
    name: string;
    description: any;
    inputSchema: any;
}[];
export declare function checkPath(workspace: string, value: string): string;
export declare function executor(device: Device): (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<{
    content: any;
    isError: boolean;
}>;
