import { DurableObject } from "cloudflare:workers";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
export type Registration = {
  device_id: string;
  token_hash: string;
  tools: string[];
};
export interface RoomEnv {
  DEVICE_CONFIG: string;
  OWNER_KEY_HASH: string;
}
export async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
type Attachment = {
  id: string;
  tokenHash: string;
  at: number;
  ready: boolean;
  tools: string[];
  platform?: string;
  pi_version?: string;
};
type Pending = {
  socket: WebSocket;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class DeviceRoom extends DurableObject<RoomEnv> {
  pending = new Map<string, Pending>();
  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  registered(): Registration[] {
    return JSON.parse(this.env.DEVICE_CONFIG || "[]");
  }
  live(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment;
    const registered = this.registered().find((d) => d.device_id === a.id);
    const last =
      this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? a.at;
    return (
      ws.readyState === 1 &&
      Date.now() - Math.max(last, a.at) < 70000 &&
      registered?.token_hash === a.tokenHash
    );
  }
  sockets() {
    return this.ctx.getWebSockets().filter((ws) => {
      if (this.live(ws)) return true;
      this.fail(ws);
      try {
        ws.close(1008, "Device expired");
      } catch {}
      return false;
    });
  }
  async fetch(request: Request) {
    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.has("Origin")
    )
      return new Response("Forbidden", { status: 403 });
    const id = request.headers.get("X-Device-Id");
    const d = this.registered().find((d) => d.device_id === id);
    const bearer = request.headers.get("Authorization") ?? "";
    if (
      !d ||
      !bearer.startsWith("Bearer ") ||
      (await digest(bearer.slice(7))) !== d.token_hash
    )
      return new Response("Unauthorized", { status: 401 });
    if (
      this.sockets().some(
        (ws) => (ws.deserializeAttachment() as Attachment).id === id,
      )
    )
      return new Response("Already connected", { status: 409 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id: d.device_id,
      tokenHash: d.token_hash,
      at: Date.now(),
      ready: false,
      tools: [],
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      if (
        typeof raw !== "string" ||
        new TextEncoder().encode(raw).length > 4 * 1024 * 1024
      )
        throw Error("Frame too large");
      const a = ws.deserializeAttachment() as Attachment;
      if (!this.live(ws)) throw Error("Expired connection");
      const m = JSON.parse(raw);
      if (!a.ready) {
        const d = this.registered().find((d) => d.device_id === a.id)!;
        if (
          m.type !== "hello" ||
          m.protocol !== 1 ||
          !Array.isArray(m.tools) ||
          m.tools.length > 32 ||
          typeof m.platform !== "string" ||
          m.platform.length > 32 ||
          typeof m.pi_version !== "string" ||
          m.pi_version.length > 64
        )
          throw Error("Invalid hello");
        ws.serializeAttachment({
          ...a,
          ready: true,
          at: Date.now(),
          tools: m.tools.filter((t: string) => d.tools.includes(t)),
          platform: m.platform,
          pi_version: m.pi_version,
        });
        ws.send(JSON.stringify({ type: "ready", device_id: a.id }));
        return;
      }
      if (m.type !== "result" || typeof m.request_id !== "string")
        throw Error("Invalid result");
      const p = this.pending.get(m.request_id);
      if (!p) return;
      if (p.socket !== ws) throw Error("Wrong response device");
      if (
        m.error !== undefined &&
        (typeof m.error !== "string" || m.error.length > 8192)
      )
        throw Error("Invalid error");
      const result = m.error ? undefined : CallToolResultSchema.parse(m.result);
      clearTimeout(p.timer);
      this.pending.delete(m.request_id);
      m.error ? p.reject(Error(m.error)) : p.resolve(result);
    } catch {
      this.fail(ws);
      ws.close(1008, "Invalid device protocol");
    }
  }
  fail(ws: WebSocket) {
    for (const [id, p] of this.pending)
      if (p.socket === ws) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.reject(
          Error(
            "Device disconnected; execution outcome unknown. Do not retry automatically.",
          ),
        );
      }
  }
  webSocketClose(ws: WebSocket, code: number) {
    this.fail(ws);
    ws.close([1005, 1006].includes(code) ? 1000 : code);
  }
  webSocketError(ws: WebSocket) {
    this.fail(ws);
    ws.close(1011, "Device error");
  }
  list() {
    const online = this.sockets();
    const devices = this.registered().map((d) => {
      const socket = online.find(
        (ws) => (ws.deserializeAttachment() as Attachment).id === d.device_id,
      );
      const a = socket?.deserializeAttachment() as Attachment | undefined;
      return {
        device_id: d.device_id,
        status: a?.ready ? "online" : "offline",
        tools: a?.ready ? a.tools : d.tools,
        platform: a?.platform,
        pi_version: a?.pi_version,
      };
    });
    return {
      online_count: devices.filter((d) => d.status === "online").length,
      devices,
    };
  }
  async call(id: string, name: string, args: Record<string, unknown>) {
    const ws = this.sockets().find((ws) => {
      const a = ws.deserializeAttachment() as Attachment;
      return a.id === id && a.ready;
    });
    if (!ws) throw Error("Target device offline or unknown; call list_devices");
    const a = ws.deserializeAttachment() as Attachment;
    const d = this.registered().find((d) => d.device_id === id)!;
    if (!a.tools.includes(name) || !d.tools.includes(name))
      throw Error("Tool not allowed on target device");
    if ([...this.pending.values()].some((p) => p.socket === ws))
      throw Error("Device busy");
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        ws.close(1011, "Call timed out");
        reject(
          Error(
            "Device response timed out; outcome unknown. Do not retry automatically.",
          ),
        );
      }, 310000);
      this.pending.set(requestId, { socket: ws, resolve, reject, timer });
      try {
        ws.send(
          JSON.stringify({
            type: "call",
            request_id: requestId,
            device_id: id,
            name,
            arguments: args,
          }),
        );
      } catch {
        this.fail(ws);
      }
    });
  }
  async limit(bucket: string, max: number) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = "limit:" + bucket;
      const old = await this.ctx.storage.get<{ at: number; n: number }>(key);
      const v =
        old && Date.now() - old.at < 60000 ? old : { at: Date.now(), n: 0 };
      v.n++;
      await this.ctx.storage.put(key, v);
      return v.n <= max;
    });
  }
  async consent(auth: AuthRequest) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const all =
        (await this.ctx.storage.get<Record<string, any>>("consents")) ?? {};
      for (const [id, v] of Object.entries(all))
        if (v.expires < Date.now()) delete all[id];
      if (Object.keys(all).length >= 64)
        throw Error("Too many pending consents");
      const id = crypto.randomUUID(),
        csrf = crypto.randomUUID();
      all[id] = { auth, csrf, expires: Date.now() + 300000 };
      await this.ctx.storage.put("consents", all);
      return { id, csrf };
    });
  }
  async approve(id: string, csrf: string, owner: string) {
    const valid = (await digest(owner)) === this.env.OWNER_KEY_HASH;
    return this.ctx.blockConcurrencyWhile(async () => {
      const all =
        (await this.ctx.storage.get<Record<string, any>>("consents")) ?? {};
      const r = all[id];
      if (!valid || !r || r.csrf !== csrf || r.expires < Date.now())
        return null;
      delete all[id];
      await this.ctx.storage.put("consents", all);
      return r.auth as AuthRequest;
    });
  }
}
