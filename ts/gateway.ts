import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { PersonalAuth } from "./auth.js";
import { Registry } from "./registry.js";
import { catalog, piVersion } from "./pi.js";
import {
  requireSecureUrl,
  secureEqual,
  type GatewayConfig,
  toolNames,
} from "./config.js";

const hello = z
  .object({
    type: z.literal("hello"),
    protocol: z.literal(1),
    tools: z.array(z.enum(toolNames)),
    platform: z.string().max(32),
    pi_version: z.string().max(64),
  })
  .strict();
export async function startGateway(config: GatewayConfig) {
  const origin = requireSecureUrl(config.public_url).origin;
  const registry = new Registry(config);
  const metadata = catalog(config.local_device?.workspace ?? process.cwd());
  const app = express();
  app.disable("x-powered-by");
  // Cloudflared uses loopback; use one trusted proxy hop only for OAuth rate limits.
  app.set("trust proxy", "loopback");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
    });
    const host = req.headers.host?.split(":")[0];
    if (
      !host ||
      ![new URL(origin).hostname, "127.0.0.1", "localhost"].includes(host)
    ) {
      res.sendStatus(400);
      return;
    }
    if (req.headers.origin && req.headers.origin !== origin) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  const auth = new PersonalAuth(
    origin,
    config.oauth_state_file,
    config.owner_key_file,
  );
  auth.mount(app);
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", service: "chat2pi", pi_version: piVersion });
  });
  const bearer = requireBearerAuth({
    verifier: auth,
    requiredScopes: ["pi:tools"],
    resourceMetadataUrl: `${origin}/.well-known/oauth-protected-resource/mcp`,
  });
  app.post("/mcp", bearer, express.json({ limit: "1mb" }), async (req, res) => {
    const disconnected = new AbortController();
    res.once("close", () => {
      if (!res.writableEnded) disconnected.abort();
    });
    const server = new Server(
      { name: "pi-tools", version: "0.2.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "先调用 list_devices 获取在线设备及其允许的工具。按用户指定选择 device_id；有歧义先询问。所有操作都在目标真实电脑执行。离线或目标错误时不得改用其他电脑。断线或超时后不得自动重试写入或命令。",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_devices",
          description:
            "列出自己的电脑代号、在线状态和允许的工具；操作电脑前先查询。",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ...metadata.map((t) => ({
          ...t,
          inputSchema: {
            ...t.inputSchema,
            properties: {
              ...t.inputSchema.properties,
              device_id: {
                type: "string",
                description: "目标电脑代号，从 list_devices 获取。",
              },
            },
            required: [...(t.inputSchema.required ?? []), "device_id"],
          },
          annotations: {
            readOnlyHint: ["read", "ls", "find", "grep"].includes(t.name),
            destructiveHint: ["write", "edit", "bash"].includes(t.name),
            idempotentHint: ["read", "ls", "find", "grep", "write"].includes(
              t.name,
            ),
            openWorldHint: t.name === "bash",
          },
        })),
      ],
    }));
    server.setRequestHandler(
      CallToolRequestSchema,
      async ({ params }, extra) => {
        try {
          if (params.name === "list_devices") {
            const list = registry.list();
            return {
              content: [{ type: "text", text: JSON.stringify(list) }],
              structuredContent: list,
            };
          }
          if (!toolNames.includes(params.name as any))
            throw new Error("Unknown tool");
          const { device_id, ...args } = params.arguments ?? {};
          if (typeof device_id !== "string" || !device_id)
            throw new Error("device_id is required; call list_devices");
          return await registry.call(
            device_id,
            params.name,
            args,
            AbortSignal.any([disconnected.signal, extra.signal]),
          );
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: error instanceof Error ? error.message : "Tool failed",
              },
            ],
          };
        }
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(500).json({ error: "MCP request failed" });
    }
  });
  app.all("/mcp", bearer, (_req, res) => {
    res.sendStatus(405);
  });
  app.use((_req, res) => {
    res.sendStatus(404);
  });
  app.use((error: any, _req: any, res: any, _next: any) => {
    if (!res.headersSent)
      res
        .status(error.status === 413 ? 413 : 400)
        .json({ error: "Invalid request" });
  });
  const http = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  });
  http.on("upgrade", (req, socket, head) => {
    const reject = (status: number) => {
      socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (req.url !== "/agent" || req.headers.origin) {
      reject(403);
      return;
    }
    const id = req.headers["x-device-id"];
    const device = config.devices.find((d) => d.device_id === id);
    if (
      !device ||
      !secureEqual(req.headers.authorization ?? "", `Bearer ${device.token}`)
    ) {
      reject(401);
      return;
    }
    if (registry.remotes.has(device.device_id)) {
      reject(409);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let attached = false,
        alive = true;
      const timeout = setTimeout(() => ws.terminate(), 10_000);
      ws.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) ws.terminate();
        else {
          alive = false;
          ws.ping();
        }
      }, 20_000);
      ws.on("message", (raw) => {
        if (raw.toString() === "ping") {
          ws.send("pong");
          return;
        }
        try {
          const m = JSON.parse(raw.toString());
          if (!attached) {
            const h = hello.parse(m);
            registry.attach(device.device_id, {
              socket: ws,
              tools: h.tools.filter((t) => device.tools.includes(t)),
              platform: h.platform,
              piVersion: h.pi_version,
            });
            attached = true;
            clearTimeout(timeout);
            ws.send(
              JSON.stringify({ type: "ready", device_id: device.device_id }),
            );
          } else {
            if (m.type !== "result" || typeof m.request_id !== "string")
              throw new Error("Invalid frame");
            if (
              m.error !== undefined &&
              (typeof m.error !== "string" || m.error.length > 8192)
            )
              throw new Error("Invalid error");
            const result = m.error
              ? undefined
              : CallToolResultSchema.parse(m.result);
            registry.result(device.device_id, m.request_id, result, m.error);
          }
        } catch {
          ws.close(1008, "Invalid device protocol");
        }
      });
      ws.on("error", () => {});
      ws.on("close", () => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        registry.detach(device.device_id, ws);
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(config.port, "127.0.0.1", resolve);
  });
  return {
    registry,
    http,
    auth,
    close: async () => {
      registry.close();
      for (const client of wss.clients) client.terminate();
      wss.close();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
