import { type Device } from "./config.js";
import { type QueueOptions } from "./tool-queue.js";
export declare class Runner {
    readonly device: Device;
    private queue;
    constructor(device: Device);
    close(): void;
    call(deviceId: string, name: string, args: Record<string, unknown>, options?: Omit<QueueOptions, "timeoutMs">): Promise<any>;
    private execute;
}
