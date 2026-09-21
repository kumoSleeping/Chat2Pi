import { executor } from "./pi.js";
const abort = new AbortController();
process.once("disconnect", () => {
    abort.abort();
    setTimeout(() => process.exit(1), 2000).unref();
});
process.on("message", (message) => {
    if (message.type === "cancel")
        abort.abort();
});
process.once("message", async (message) => {
    try {
        const result = await executor(message.device)(message.name, message.args, abort.signal);
        if (Buffer.byteLength(JSON.stringify(result)) > 3 * 1024 * 1024)
            throw new Error("Result exceeds 3 MiB; operation may have completed. Use a smaller read.");
        process.send?.({ result }, () => process.exit(0));
    }
    catch (error) {
        process.send?.({ error: error instanceof Error ? error.message : "Tool failed" }, () => process.exit(0));
    }
});
