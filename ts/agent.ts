import { WebSocket } from "ws";
import { z } from "zod";
import { Runner } from "./runner.js";
import { makeTools, piVersion } from "./pi.js";
import { requireSecureUrl, type AgentConfig } from "./config.js";
const callSchema = z
  .object({
    type: z.literal("call"),
    request_id: z.string().uuid(),
    device_id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })
  .strict();
export function startAgent(config: AgentConfig) {
  makeTools(config.device.workspace);
  const url = requireSecureUrl(config.gateway_url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/agent";
  const runner = new Runner(config.device);
  let stopped = false,
    ws: WebSocket,
    reconnect: NodeJS.Timeout;
  let delay = 1000;
  function connect() {
    if (stopped) return;
    ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.device_token}`,
        "X-Device-Id": config.device.device_id,
      },
      maxPayload: 1024 * 1024,
      handshakeTimeout: 15_000,
    });
    const connection = ws;
    let heartbeat: NodeJS.Timeout;
    const touch = () => {
      clearTimeout(heartbeat);
      heartbeat = setTimeout(() => connection.terminate(), 60_000);
    };
    connection.on("open", () => {
      touch();
      connection.send(
        JSON.stringify({
          type: "hello",
          protocol: 1,
          tools: config.device.tools,
          platform: process.platform,
          pi_version: piVersion,
        }),
      );
    });
    connection.on("ping", touch);
    connection.on("message", async (raw) => {
      let requestId: string | undefined;
      try {
        const message = JSON.parse(raw.toString());
        if (
          message.type === "ready" &&
          message.device_id === config.device.device_id
        ) {
          delay = 1000;
          console.log(`Device online: ${config.device.device_id}`);
          return;
        }
        const call = callSchema.parse(message);
        requestId = call.request_id;
        const result = await runner.call(
          call.device_id,
          call.name,
          call.arguments,
        );
        const payload = JSON.stringify({
          type: "result",
          request_id: requestId,
          result,
        });
        if (Buffer.byteLength(payload) > 3 * 1024 * 1024)
          throw new Error(
            "Result too large; operation may have completed. Use smaller reads.",
          );
        if (connection.readyState === WebSocket.OPEN) connection.send(payload);
      } catch (error) {
        if (!requestId) {
          connection.close(1008, "Invalid call");
          return;
        }
        if (connection.readyState === WebSocket.OPEN)
          connection.send(
            JSON.stringify({
              type: "result",
              request_id: requestId,
              error:
                error instanceof Error
                  ? error.message.slice(0, 8192)
                  : "Tool failed",
            }),
          );
      }
    });
    connection.on("error", () => {});
    connection.on("close", () => {
      clearTimeout(heartbeat);
      runner.close();
      if (!stopped) {
        console.log(
          "Connection lost; reconnecting (operations are never replayed).",
        );
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
    },
  };
}
