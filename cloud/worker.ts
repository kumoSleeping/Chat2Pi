import { WorkerEntrypoint } from "cloudflare:workers";
import {
  OAuthProvider,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DeviceRoom, type RoomEnv } from "./room";
import catalog from "./catalog.json";
export { DeviceRoom };
interface Env extends RoomEnv {
  ROOM: DurableObjectNamespace<DeviceRoom>;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  PUBLIC_URL: string;
}
const room = (env: Env) => env.ROOM.getByName("owner");
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'",
};
const html = (body: string, extra: Record<string, string> = {}) =>
  new Response(
    `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chat with Pi Tools</title><style>body{font:17px system-ui;max-width:620px;margin:10vh auto;padding:24px;line-height:1.7}input,button{font:inherit;padding:12px;margin-top:16px}input{width:90%}</style>${body}`,
    {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        ...extra,
      },
    },
  );
class McpApi extends WorkerEntrypoint<
  Env,
  { userId: string; scope: string[] }
> {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/mcp")
      return new Response("Not found", { status: 404 });
    if (
      this.ctx.props.userId !== "owner" ||
      !this.ctx.props.scope?.includes("pi:tools")
    )
      return new Response("Forbidden", { status: 403 });
    const registry = room(this.env);
    const server = new Server(
      { name: "Chat with Pi Tools", version: "0.3.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "先调用 list_devices 查询在线电脑。每次调用必须指定用户选定的 device_id。设备离线或报错时不得改用其他电脑。超时、断线后不能自动重试写入或命令。",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_devices",
          description:
            "查询自己的在线电脑、设备代号和允许的工具。操作电脑前先调用。",
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
        ...catalog.map((t) => ({
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
            required: [...((t.inputSchema as any).required ?? []), "device_id"],
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
      ] as any,
    }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      try {
        if (params.name === "list_devices") {
          // RPC results carry disposal symbols; MCP payloads must be plain JSON.
          const list = JSON.parse(JSON.stringify(await registry.list()));
          return {
            content: [{ type: "text" as const, text: JSON.stringify(list) }],
          };
        }
        if (!catalog.some((t) => t.name === params.name))
          throw Error("Unknown tool");
        const { device_id, ...args } = params.arguments ?? {};
        if (typeof device_id !== "string" || !device_id)
          throw Error("device_id is required; call list_devices");
        return JSON.parse(
          JSON.stringify(await registry.call(device_id, params.name, args)),
        );
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: e instanceof Error ? e.message : "Tool failed",
            },
          ],
        };
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      return response;
    } finally {
      await server.close();
    }
  }
}
const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url),
      r = room(env);
    if (url.pathname === "/healthz")
      return Response.json({ status: "ok", service: "chat2pi-cloud" });
    if (url.pathname === "/agent") return r.fetch(request);
    if (url.pathname === "/authorize" && request.method === "GET") {
      if (!(await r.limit("authorize", 30)))
        return new Response("Please retry later", { status: 429 });
      const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      if (
        auth.scope.some((s) => s !== "pi:tools") ||
        auth.codeChallengeMethod !== "S256" ||
        !auth.codeChallenge
      )
        return new Response("Scope or PKCE invalid", { status: 400 });
      const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
      if (!client) return new Response("Unknown client", { status: 400 });
      const { id, csrf } = await r.consent(auth);
      return html(
        `<h1>连接 Chat with Pi Tools</h1><p>允许 ChatGPT 调用你登记的电脑工具，包括已经启用的文件写入和命令执行。</p><p>客户端：${escape(client.clientName ?? auth.clientId)}</p><p>返回地址：${escape(auth.redirectUri)}</p><form method="post" action="/approve"><input type="hidden" name="request" value="${id}"><label>个人授权密钥<input name="owner_key" type="password" required autocomplete="off"></label><button type="submit">授权连接</button></form>`,
        {
          "Set-Cookie": `pi_consent=${csrf}; HttpOnly; Secure; SameSite=Lax; Path=/approve; Max-Age=300`,
        },
      );
    }
    if (url.pathname === "/approve" && request.method === "POST") {
      if (
        request.headers.get("Origin") !== env.PUBLIC_URL ||
        !(await r.limit("approve", 20))
      )
        return new Response("Forbidden", { status: 403 });
      const form = new URLSearchParams(await request.text());
      const csrf =
        (request.headers.get("Cookie") ?? "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("pi_consent="))
          ?.slice(11) ?? "";
      const auth = await r.approve(
        form.get("request") ?? "",
        csrf,
        form.get("owner_key") ?? "",
      );
      if (!auth) return new Response("Authorization failed", { status: 403 });
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: auth,
        userId: "owner",
        metadata: { source: "personal-consent" },
        scope: ["pi:tools"],
        props: { userId: "owner", scope: ["pi:tools"] },
      });
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          Location: redirectTo,
          "Set-Cookie":
            "pi_consent=; HttpOnly; Secure; SameSite=Lax; Path=/approve; Max-Age=0",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.origin !== env.PUBLIC_URL)
      return new Response("Wrong host", { status: 400 });
    if (
      request.headers.has("Origin") &&
      request.headers.get("Origin") !== env.PUBLIC_URL
    )
      return new Response("Forbidden", { status: 403 });
    if (request.method === "POST") {
      const text = await request.clone().text();
      if (
        new TextEncoder().encode(text).length >
        (url.pathname === "/mcp" ? 1048576 : 16384)
      )
        return new Response("Too large", { status: 413 });
    }
    if (
      url.pathname === "/register" &&
      !(await room(env).limit("register", 10))
    )
      return new Response("Registration limited", { status: 429 });
    const provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: McpApi,
      defaultHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["pi:tools"],
      allowPlainPKCE: false,
      accessTokenTTL: 3600,
      refreshTokenTTL: 2592000,
      resourceMetadata: {
        resource: env.PUBLIC_URL + "/mcp",
        authorization_servers: [env.PUBLIC_URL],
        scopes_supported: ["pi:tools"],
        resource_name: "Chat with Pi Tools",
      },
    });
    try {
      const response = await provider.fetch(request, env, ctx);
      if (response.status !== 101)
        for (const [k, v] of Object.entries(headers))
          response.headers.set(k, v);
      return response;
    } catch {
      return new Response("Invalid request", { status: 400, headers });
    }
  },
};
