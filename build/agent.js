import { randomUUID } from "node:crypto";
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
    // Stable only for this agent's lifetime; never persisted or used as a credential.
    const instanceId = randomUUID();
    let stopped = false, ws, reconnect;
    let delay = 1000;
    let attempts = 0;
    let generation = 0;
    let offlineSince = performance.now();
    let previouslyOnline = false;
    function connect() {
        if (stopped)
            return;
        attempts++;
        ws = new WebSocket(url, {
            agent: proxy,
            headers: {
                Authorization: `Bearer ${config.device_token}`,
                "X-Device-Id": config.device.device_id,
                "X-Agent-Instance": instanceId,
                "X-Agent-Connection": String(++generation),
                ...(config.account_id ? { "X-Account-Id": config.account_id } : {}),
            },
            maxPayload: 1024 * 1024,
            handshakeTimeout: 15_000,
        });
        const connection = ws;
        const calls = new Map();
        let heartbeat;
        let keepalive;
        let readyTimeout;
        let lastHeartbeatAt;
        let cause = "remote-close";
        let httpStatus;
        let cfRay = "none";
        const touch = () => {
            if (stopped || connection !== ws)
                return;
            lastHeartbeatAt = performance.now();
            clearTimeout(heartbeat);
            heartbeat = setTimeout(() => {
                cause = "heartbeat-timeout";
                connection.terminate();
            }, 60_000);
        };
        connection.on("open", () => {
            if (stopped || connection !== ws) {
                connection.terminate();
                return;
            }
            touch();
            readyTimeout = setTimeout(() => {
                cause = "ready-timeout";
                connection.terminate();
            }, 15_000);
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
            if (stopped ||
                connection !== ws ||
                connection.readyState !== WebSocket.OPEN)
                return;
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
                    clearTimeout(readyTimeout);
                    if (previouslyOnline && offlineSince !== undefined)
                        log("INFO", `连接恢复：离线 ${((performance.now() - offlineSince) / 1000).toFixed(1)} 秒，重连 ${attempts} 次`);
                    previouslyOnline = true;
                    offlineSince = undefined;
                    attempts = 0;
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
                    cause = "protocol-error";
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
                if (!stopped &&
                    connection === ws &&
                    connection.readyState === WebSocket.OPEN) {
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
                    cause = "protocol-error";
                    connection.close(1008, "Invalid call");
                    return;
                }
                log("ERROR", `${summary} · ${errorSummary(error)}`, `${operation} duration=${elapsed()} | ${preview(error instanceof Error ? error.message : "Tool failed", 500)}`);
                if (!stopped &&
                    connection === ws &&
                    connection.readyState === WebSocket.OPEN)
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
        connection.on("unexpected-response", (request, response) => {
            httpStatus = response.statusCode;
            cfRay = preview(response.headers["cf-ray"] ?? "none", 100);
            cause = "handshake-http";
            // Handling this event disables ws's default rejection. Explicitly destroy
            // the request so error/close still run; never read or log response bodies.
            request.destroy(new Error(`Unexpected server response: ${httpStatus}`));
        });
        connection.on("error", (error) => {
            if (stopped || connection !== ws)
                return;
            if (cause === "remote-close")
                cause = "transport-error";
            const detail = preview(error.message.replaceAll(config.device_token, "[redacted]"), 500);
            const hint = httpStatus === 409
                ? "设备已有连接（其他实例或旧连接仍占用）"
                : httpStatus === 401 || httpStatus === 403
                    ? "鉴权被拒绝，请检查设备凭证或服务访问策略"
                    : detail;
            log("ERROR", `连接失败：${httpStatus ? `HTTP ${httpStatus} · ` : ""}${hint}`, `Device ${config.device.device_id}: connection failed cause=${cause} code=${error.code ?? "none"} http=${httpStatus ?? "none"} cf-ray=${cfRay} message=${detail}`);
        });
        connection.on("close", (code, reason) => {
            clearTimeout(heartbeat);
            clearTimeout(readyTimeout);
            clearInterval(keepalive);
            // Only cancel this socket's calls. An old close callback must not cancel
            // new work; the shared runner still bounds concurrency during cleanup.
            for (const controller of calls.values())
                controller.abort(new Error("Device disconnected; operation cancelled. Side effects may have occurred."));
            if (stopped || connection !== ws)
                return;
            offlineSince ??= performance.now();
            const lastHeartbeat = lastHeartbeatAt === undefined
                ? "none"
                : `${((performance.now() - lastHeartbeatAt) / 1000).toFixed(1)}s`;
            const details = `Device ${config.device.device_id}: connection lost cause=${cause} code=${code} reason=${preview(reason.toString() || "none")} http=${httpStatus ?? "none"} lastHeartbeatAgo=${lastHeartbeat} attempts=${attempts} offline=${((performance.now() - offlineSince) / 1000).toFixed(1)}s (operations are never replayed).`;
            if (code === 4001) {
                log("WARN", "连接已被同一实例的新连接接替，停止重连", details);
                return;
            }
            const retryDelay = httpStatus === 401 || httpStatus === 403 || code === 1008
                ? 60_000
                : httpStatus === 409
                    ? 15_000
                    : delay;
            const wait = retryDelay + Math.random() * Math.min(retryDelay * 0.2, 1000);
            const hint = cause === "heartbeat-timeout"
                ? "心跳超时（60 秒未收到心跳）"
                : cause === "ready-timeout"
                    ? "连接建立后 15 秒未收到 ready"
                    : `连接断开（${code}）`;
            log("WARN", `${hint}，约 ${(wait / 1000).toFixed(0)} 秒后重连`, `${details} reconnect≈${(wait / 1000).toFixed(1)}s`);
            reconnect = setTimeout(connect, wait);
            delay = Math.min(delay * 2, 30_000);
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
