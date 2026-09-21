import { WebSocket } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { z } from "zod";
import { Runner } from "./runner.js";
import { log, preview, argumentPreview } from "./log.js";
import { makeTools, piVersion } from "./pi.js";
import { requireSecureUrl } from "./config.js";
const callSchema = z
    .object({
    type: z.literal("call"),
    request_id: z.string().uuid(),
    device_id: z.string(),
    account_id: z.string().optional(),
    name: z.string(),
    arguments: z.record(z.unknown()),
})
    .strict();
export function startAgent(config) {
    makeTools(config.device.workspace, config.device.shell_path);
    const proxy = config.proxy_url
        ? new HttpsProxyAgent(config.proxy_url)
        : undefined;
    const url = requireSecureUrl(config.gateway_url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/agent";
    const runner = new Runner(config.device);
    let stopped = false, ws, reconnect;
    let delay = 1000;
    function connect() {
        if (stopped)
            return;
        ws = new WebSocket(url, {
            agent: proxy,
            headers: {
                Authorization: `Bearer ${config.device_token}`,
                "X-Device-Id": config.device.device_id,
                ...(config.account_id ? { "X-Account-Id": config.account_id } : {}),
            },
            maxPayload: 1024 * 1024,
            handshakeTimeout: 15_000,
        });
        const connection = ws;
        let heartbeat;
        let keepalive;
        const touch = () => {
            clearTimeout(heartbeat);
            heartbeat = setTimeout(() => connection.terminate(), 60_000);
        };
        connection.on("open", () => {
            touch();
            keepalive = setInterval(() => {
                if (connection.readyState === WebSocket.OPEN)
                    connection.send("ping");
            }, 20_000);
            connection.send(JSON.stringify({
                type: "hello",
                protocol: 1,
                account_id: config.account_id,
                tools: config.device.tools,
                platform: process.platform,
                pi_version: piVersion,
            }));
        });
        connection.on("ping", touch);
        connection.on("message", async (raw) => {
            if (raw.toString() === "pong") {
                touch();
                return;
            }
            let requestId;
            let operation = config.device.device_id;
            const startedAt = performance.now();
            const elapsed = () => `${((performance.now() - startedAt) / 1000).toFixed(2)}s`;
            try {
                const message = JSON.parse(raw.toString());
                if (message.type === "ready" &&
                    message.device_id === config.device.device_id &&
                    message.account_id === config.account_id) {
                    delay = 1000;
                    log("OK", `Device online: ${config.device.device_id}${config.account_id ? ` (account: ${config.account_id})` : ""} workspace=${preview(config.device.workspace, 240)} timeout=${config.device.timeout_seconds}s tools=${config.device.tools.join(",")}`);
                    return;
                }
                const call = callSchema.parse(message);
                requestId = call.request_id;
                if (call.account_id !== config.account_id)
                    throw new Error("Wrong account; refused before execution");
                operation = `${config.account_id ?? "local"}/${config.device.device_id}/${call.name} #${requestId.slice(0, 8)}`;
                log("START", `${operation} cwd=${preview(config.device.workspace, 240)} timeout=${config.device.timeout_seconds}s | ${argumentPreview(call.arguments)}`);
                const result = await runner.call(call.device_id, call.name, call.arguments);
                const payload = JSON.stringify({
                    type: "result",
                    request_id: requestId,
                    result,
                });
                if (Buffer.byteLength(payload) > 3 * 1024 * 1024)
                    throw new Error("Result too large; operation may have completed. Use smaller reads.");
                if (connection.readyState === WebSocket.OPEN) {
                    connection.send(payload);
                    const detail = result.isError
                        ? preview(result.content?.find((item) => item.type === "text")
                            ?.text ?? "Tool returned an error", 300)
                        : `result=${Buffer.byteLength(payload)}B`;
                    log(result.isError ? "ERROR" : "OK", `${operation} duration=${elapsed()} | ${detail}`);
                }
                else {
                    log("WARN", `${operation} duration=${elapsed()} | Completed but connection closed; result not sent`);
                }
            }
            catch (error) {
                if (!requestId) {
                    connection.close(1008, "Invalid call");
                    return;
                }
                log("ERROR", `${operation} duration=${elapsed()} | ${preview(error instanceof Error ? error.message : "Tool failed", 500)}`);
                if (connection.readyState === WebSocket.OPEN)
                    connection.send(JSON.stringify({
                        type: "result",
                        request_id: requestId,
                        error: error instanceof Error
                            ? error.message.slice(0, 8192)
                            : "Tool failed",
                    }));
            }
        });
        connection.on("error", (error) => {
            log("ERROR", `Device ${config.device.device_id}: connection failed (${error.code ?? "WebSocket handshake/network error"}); check network, server and device credentials.`);
        });
        connection.on("close", (code, reason) => {
            clearTimeout(heartbeat);
            clearInterval(keepalive);
            runner.close();
            if (!stopped) {
                log("WARN", `Device ${config.device.device_id}: connection lost code=${code} reason=${preview(reason.toString() || "none")} reconnect≈${(delay / 1000).toFixed(1)}s (operations are never replayed).`);
                reconnect = setTimeout(connect, delay + Math.random() * 500);
                delay = Math.min(delay * 2, 30_000);
            }
        });
    }
    connect();
    return {
        close() {
            stopped = true;
            clearTimeout(reconnect);
            runner.close();
            ws?.terminate();
            proxy?.destroy();
        },
    };
}
