import { executor } from "./pi.js";
import type { Device } from "./config.js";
process.once(
  "message",
  async (message: {
    device: Device;
    name: string;
    args: Record<string, unknown>;
  }) => {
    try {
      const result = await executor(message.device)(
        message.name,
        message.args,
        new AbortController().signal,
      );
      if (Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024)
        throw new Error(
          "Result exceeds 3 MiB; operation may have completed. Use a smaller read.",
        );
      process.send?.({ result }, () => process.exit(0));
    } catch (error) {
      process.send?.(
        { error: error instanceof Error ? error.message : "Tool failed" },
        () => process.exit(0),
      );
    }
  },
);
