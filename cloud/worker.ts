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
import { Directory, type Identity } from "./directory";
import { identifier, manageTool, directCallSchema } from "../ts/manifest";
export { DeviceRoom, Directory };
interface Env extends RoomEnv {
  ROOM: DurableObjectNamespace<DeviceRoom>;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  PUBLIC_URL: string;
  BOOTSTRAP_KEY_SHA256: string;
}
const room = (env: Env, account: string) =>
  env.ROOM.getByName("account:" + account);
const directory = (env: Env) => env.DIRECTORY.getByName("directory");
async function manage(env: Env, identity: Identity, input: unknown) {
  const result = await directory(env).manage(identity, input);
  if ((input as any)?.action === "list_devices")
    return await room(env, (result as any).account_id).list(
      (result as any).account_id,
    );
  return result;
}
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
function claimPage() {
  const nonce = crypto.randomUUID();
  return html(
    `<h1>领取凭证</h1><p>凭证仅显示一次，请保存在自己的电脑，不要粘贴到聊天中。</p><button id="claim">领取并下载</button><pre id="result"></pre><script nonce="${nonce}">
  const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  document.getElementById('claim').onclick=async()=>{
    const button=document.getElementById('claim');button.disabled=true;
    try {const response=await fetch('/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:token})});
      if(!response.ok)throw Error('链接已失效、已使用或被撤销');
      const value=await response.json(),data=JSON.stringify(value,null,2),blob=new Blob([data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chat2pi-credentials.json';a.click();
      document.getElementById('result').textContent=data;
    }catch(error){document.getElementById('result').textContent=error.message;}
  };</script>`,
    {
      "Content-Security-Policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'`,
      "Referrer-Policy": "no-referrer",
    },
  );
}
class McpApi extends WorkerEntrypoint<Env, Identity & { scope: string[] }> {
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/mcp")
      return new Response("Not found", { status: 404 });
    if (
      !(await directory(this.env).identity(this.ctx.props)) ||
      !this.ctx.props.scope?.includes("pi:tools")
    )
      return new Response("Authentication required", {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${this.env.PUBLIC_URL}/.well-known/oauth-protected-resource"`,
        },
      });
    const identity = this.ctx.props;
    const registry = room(this.env, identity.accountId);
    const server = new Server(
      { name: "Chat with Pi Tools", version: "0.4.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "先调用 list_devices 查询在线电脑。manage 要求确认时，获得用户确认后才能提交 confirmation_id。每次调用必须指定用户选定的 device_id。设备离线或报错时不得改用其他电脑。超时、断线后不能自动重试写入或命令。",
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        manageTool,
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
        if (params.name === "manage")
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  await manage(this.env, identity, params.arguments ?? {}),
                ),
              },
            ],
          };
        if (params.name === "list_devices") {
          // RPC results carry disposal symbols; MCP payloads must be plain JSON.
          const list = JSON.parse(
            JSON.stringify(await registry.list(identity.accountId)),
          );
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
          JSON.stringify(
            await registry.call(
              identity.accountId,
              device_id,
              params.name,
              args,
            ),
          ),
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
      r = directory(env);
    if (url.pathname === "/healthz")
      return Response.json({ status: "ok", service: "chat2pi-cloud" });
    if (url.pathname === "/agent") {
      const account = request.headers.get("X-Account-Id") ?? "";
      if (!identifier.safeParse(account).success)
        return new Response("Unauthorized", { status: 401 });
      return room(env, account).fetch(request);
    }
    if (url.pathname === "/bootstrap" && request.method === "POST") {
      if (!(await r.limit("bootstrap", 10)))
        return new Response("Rate limited", { status: 429 });
      const body = (await request.json()) as any;
      return Response.json(
        await r.bootstrap(
          (request.headers.get("Authorization") ?? "").replace(/^Bearer /, ""),
          body.account_id,
          body.name,
        ),
      );
    }
    if (
      ["/api/manage", "/api/call"].includes(url.pathname) &&
      request.method === "POST"
    ) {
      if (!(await r.limit("api-login", 60)))
        return new Response("Rate limited", { status: 429 });
      const identity = await r.authenticate(
        request.headers.get("X-Account-Id") ?? "",
        (request.headers.get("Authorization") ?? "").replace(/^Bearer /, ""),
      );
      if (!identity) return new Response("Unauthorized", { status: 401 });
      if (url.pathname === "/api/call") {
        const input = directCallSchema.parse(await request.json());
        return Response.json(
          await room(env, identity.accountId).call(
            identity.accountId,
            input.device_id,
            input.name,
            input.arguments,
          ),
        );
      }
      return Response.json(await manage(env, identity, await request.json()));
    }
    if (url.pathname === "/claim" && request.method === "POST") {
      if (!(await r.limit("claim", 30)))
        return new Response("Rate limited", { status: 429 });
      const body = (await request.json()) as any;
      if (typeof body.code !== "string" || !/^[a-f0-9]{64}$/.test(body.code))
        return new Response("Invalid claim", { status: 400 });
      return Response.json(await r.claim(body.code));
    }
    if (url.pathname === "/claim" && request.method === "GET")
      return claimPage();
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
        `<h1>连接 Chat with Pi Tools</h1><p>允许 ChatGPT 调用你登记的电脑工具，包括已经启用的文件写入和命令执行。</p><p>客户端：${escape(client.clientName ?? auth.clientId)}</p><p>返回地址：${escape(auth.redirectUri)}</p><form method="post" action="/approve"><input type="hidden" name="request" value="${id}"><label>服务账号<input name="account_id" required autocomplete="username"></label><label>账号登录密钥<input name="owner_key" type="password" required autocomplete="off"></label><button type="submit">授权连接</button></form>`,
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
        form.get("account_id") ?? "",
        form.get("owner_key") ?? "",
      );
      if (!auth) return new Response("Authorization failed", { status: 403 });
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: auth.auth,
        userId: auth.identity.accountId,
        metadata: { source: "personal-consent" },
        scope: ["pi:tools"],
        props: { ...auth.identity, scope: ["pi:tools"] },
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
    if (request.method === "POST" && request.body) {
      const reader = request.body.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      const limit = ["/mcp", "/api/call"].includes(url.pathname)
        ? 1048576
        : 16384;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          void reader.cancel();
          return new Response("Too large", { status: 413 });
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      request = new Request(request, { body: bytes });
    }
    if (
      url.pathname === "/register" &&
      !(await directory(env).limit("register", 10))
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
      let response = await provider.fetch(request, env, ctx);
      if (response.status !== 101) {
        response = new Response(response.body, response);
        for (const [k, v] of Object.entries(headers))
          if (!response.headers.has(k)) response.headers.set(k, v);
      }
      return response;
    } catch {
      return new Response("Invalid request", { status: 400, headers });
    }
  },
};
