import { WebSocket } from "ws";
import type { GatewayConfig } from "./config.js";
import { Runner } from "./runner.js";
type Remote = {
    socket: WebSocket;
    tools: string[];
    platform: string;
    piVersion: string;
};
export declare class Registry {
    readonly config: GatewayConfig;
    readonly remotes: Map<string, Remote>;
    private pending;
    readonly local?: Runner;
    constructor(config: GatewayConfig);
    attach(id: string, remote: Remote): void;
    detach(id: string, socket: WebSocket): void;
    result(id: string, requestId: string, result: unknown, error?: string): void;
    list(): {
        online_count: number;
        devices: {
            device_id: string;
            status: string;
            tools: string[];
            platform: string | undefined;
            pi_version: string | undefined;
        }[];
    };
    call(id: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
    close(): void;
}
export {};
