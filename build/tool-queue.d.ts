export type QueueOptions = {
    timeoutMs: number;
    signal?: AbortSignal;
    onQueued?: (ahead: number) => void;
    onStart?: (waitMs: number) => void;
};
export declare class ToolQueue {
    readonly maxConcurrent: number;
    private waiting;
    private active;
    constructor(maxConcurrent: number);
    close(): void;
    run<T>(task: (signal: AbortSignal) => Promise<T>, options: QueueOptions): Promise<T>;
    private drain;
}
