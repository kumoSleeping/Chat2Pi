export declare function preview(value: unknown, limit?: number): string;
export declare function argumentPreview(args: Record<string, unknown>): string;
type Level = "INFO" | "QUEUE" | "START" | "OK" | "WARN" | "ERROR";
export declare function log(level: Level, message: string): void;
export declare function colorizeLog(line: string): string;
export {};
