import type { Device } from "./config.js";
export declare class Runner {
    readonly device: Device;
    private busy;
    private stop?;
    constructor(device: Device);
    close(): void;
    call(deviceId: string, name: string, args: Record<string, unknown>): Promise<any>;
}
