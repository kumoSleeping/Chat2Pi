export declare function preview(value: unknown, limit?: number): string;
export declare function argumentPreview(args: Record<string, unknown>): string;
export declare function operationSummary(name: string, args: Record<string, unknown>, workspace: string): string;
export declare function errorSummary(error: unknown): string;
type Level = "INFO" | "QUEUE" | "START" | "OK" | "WARN" | "ERROR";
export declare function log(level: Level, message: string, details?: string): void;
export declare function formatLogLine(line: string): string | undefined;
export {};
