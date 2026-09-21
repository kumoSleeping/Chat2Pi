import { WebSocket } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { z } from "zod";
import { Runner } from "./runner.js";
import { log, preview, argumentPreview, operationSummary, errorSummary, } from "./log.js";
import { makeTools, piVersion } from "./pi.js";
import { DEFAULT_MAX_CONCURRENT, requireSecureUrl, } from "./config.js";
const cancelSchema = z
    .object({
    type: z.literal("cancel"),
    request_id: z.string().uuid(),
})
    .strict();
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
        const calls = new Map();
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
            let summary = "工具调用";
            const startedAt = performance.now();
            const elapsed = () => `${((performance.now() - startedAt) / 1000).toFixed(2)}s`;
            try {
                const message = JSON.parse(raw.toString());
                if (message.type === "ready" &&
                    message.device_id === config.device.device_id &&
                    message.account_id === config.account_id) {
                    delay = 1000;
                    log("INFO", `Device online: ${config.device.device_id}`, `account=${config.account_id ?? "local"} workspace=${preview(config.device.workspace, 240)} timeout=${config.device.timeout_seconds}s max_concurrent=${config.device.max_concurrent ?? DEFAULT_MAX_CONCURRENT} tools=${config.device.tools.join(",")}`);
                    log("INFO", `工作目录：${preview(config.device.workspace, 240)}`);
                    return;
                }
                if (message.type === "cancel") {
                    const cancel = cancelSchema.parse(message);
                    calls.get(cancel.request_id)?.abort();
                    return;
                }
                const call = callSchema.parse(message);
                if (calls.has(call.request_id)) {
                    connection.close(1008, "Duplicate request ID");
                    return;
                }
                requestId = call.request_id;
                summary = operationSummary(call.name, call.arguments, config.device.workspace);
                if (call.account_id !== config.account_id)
                    throw new Error("Wrong account; refused before execution");
                operation = `${config.account_id ?? "local"}/${config.device.device_id}/${call.name} #${requestId.slice(0, 8)}`;
                const controller = new AbortController();
                calls.set(requestId, controller);
                const details = `cwd=${preview(config.device.workspace, 240)} budget=${config.device.timeout_seconds}s | ${argumentPreview(call.arguments)}`;
                const result = await runner.call(call.device_id, call.name, call.arguments, {
                    signal: controller.signal,
                    onQueued: (ahead) => log("QUEUE", `排队中 · ${summary}`, `${operation} ahead=${ahead} | ${details}`),
                    onStart: (waitMs) => log("START", summary, `${operation} wait=${(waitMs / 1000).toFixed(2)}s | ${details}`),
                });
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
                        ? String(result.content?.find((item) => item.type === "text")
                            ?.text ?? "Tool returned an error")
                        : `result=${Buffer.byteLength(payload)}B`;
                    log(result.isError ? "ERROR" : "OK", result.isError ? `${summary} · ${errorSummary(detail)}` : summary, `${operation} duration=${elapsed()} | ${preview(detail, 500)}`);
                }
                else {
                    log("WARN", `${summary} · 已完成，但连接断开，结果未送达`, `${operation} duration=${elapsed()} | Completed but connection closed; result not sent`);
                }
            }
            catch (error) {
                if (!requestId) {
                    connection.close(1008, "Invalid call");
                    return;
                }
                log("ERROR", `${summary} · ${errorSummary(error)}`, `${operation} duration=${elapsed()} | ${preview(error instanceof Error ? error.message : "Tool failed", 500)}`);
                if (connection.readyState === WebSocket.OPEN)
                    connection.send(JSON.stringify({
                        type: "result",
                        request_id: requestId,
                        error: error instanceof Error
                            ? error.message.slice(0, 8192)
                            : "Tool failed",
                    }));
            }
            finally {
                if (requestId)
                    calls.delete(requestId);
            }
        });
        connection.on("error", (error) => {
            log("ERROR", `连接失败：${error.code ?? "请检查网络、服务地址和设备凭证"}`, `Device ${config.device.device_id}: connection failed (${error.code ?? "WebSocket handshake/network error"}); check network, server and device credentials.`);
        });
        connection.on("close", (code, reason) => {
            clearTimeout(heartbeat);
            clearInterval(keepalive);
            runner.close();
            if (!stopped) {
                log("WARN", `连接断开，约 ${(delay / 1000).toFixed(0)} 秒后重连`, `Device ${config.device.device_id}: connection lost code=${code} reason=${preview(reason.toString() || "none")} reconnect≈${(delay / 1000).toFixed(1)}s (operations are never replayed).`);
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
