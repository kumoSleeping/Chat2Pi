import { DurableObject } from "cloudflare:workers";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Directory } from "./directory";
import { digest } from "./crypto";
export interface RoomEnv {
  DIRECTORY: DurableObjectNamespace<Directory>;
}
type Attachment = {
  id: string;
  account: string;
  tokenHash: string;
  at: number;
  ready: boolean;
  tools: string[];
  platform?: string;
  pi_version?: string;
};
type Pending = {
  account: string;
  socket: WebSocket;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class DeviceRoom extends DurableObject<RoomEnv> {
  pending = new Map<string, Pending>();
  // A cancellation may arrive while call() is still checking the binding.
  private cancelled = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  directory() {
    return this.env.DIRECTORY.getByName("directory");
  }
  async registered(account: string) {
    return await this.directory().registered(account);
  }
  async live(ws: WebSocket) {
    const a = ws.deserializeAttachment() as Attachment;
    const registered = await this.directory().checkBinding(
      a.account,
      a.id,
      a.tokenHash,
    );
    const last =
      this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? a.at;
    return (
      ws.readyState === 1 &&
      Date.now() - Math.max(last, a.at) < 70000 &&
      !!registered
    );
  }
  async sockets() {
    const live: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (await this.live(ws)) live.push(ws);
      else {
        this.fail(ws);
        try {
          ws.close(1008, "Binding revoked or expired");
        } catch {}
      }
    }
    return live;
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(() => this.connectDevice(request));
  }
  private async connectDevice(request: Request) {
    if (
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.has("Origin")
    )
      return new Response("Forbidden", { status: 403 });
    const id = request.headers.get("X-Device-Id");
    const account = request.headers.get("X-Account-Id") ?? "";
    const d = (await this.registered(account)).find((d) => d.device_id === id);
    const bearer = request.headers.get("Authorization") ?? "";
    if (
      !d ||
      !bearer.startsWith("Bearer ") ||
      (await digest(bearer.slice(7))) !== d.device_key_sha256
    )
      return new Response("Unauthorized", { status: 401 });
    if (
      (await this.sockets()).some(
        (ws) => (ws.deserializeAttachment() as Attachment).id === id,
      )
    )
      return new Response("Already connected", { status: 409 });
    const existingAccount = await this.ctx.storage.get<string>("account");
    if (existingAccount && existingAccount !== account)
      return new Response("Wrong account", { status: 403 });
    await this.ctx.storage.put("account", account);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id: d.device_id,
      account,
      tokenHash: d.device_key_sha256,
      at: Date.now(),
      ready: false,
      tools: [],
    } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      if (
        typeof raw !== "string" ||
        new TextEncoder().encode(raw).length > 4 * 1024 * 1024
      )
        throw Error("Frame too large");
      const a = ws.deserializeAttachment() as Attachment;
      if (!(await this.live(ws))) throw Error("Expired connection");
      const m = JSON.parse(raw);
      if (!a.ready) {
        const d = (await this.registered(a.account)).find(
          (d) => d.device_id === a.id,
        )!;
        if (
          m.type !== "hello" ||
          m.protocol !== 1 ||
          m.account_id !== a.account ||
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
          tools: m.tools.filter((t: string) =>
            (d.tools as string[]).includes(t),
          ),
          platform: m.platform,
          pi_version: m.pi_version,
        });
        ws.send(
          JSON.stringify({
            type: "ready",
            device_id: a.id,
            account_id: a.account,
          }),
        );
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
  async list(account: string) {
    const online = await this.sockets();
    const devices = (await this.registered(account)).map((d) => {
      const socket = online.find(
        (ws) => (ws.deserializeAttachment() as Attachment).id === d.device_id,
      );
      const a = socket?.deserializeAttachment() as Attachment | undefined;
      return {
        device_id: d.device_id,
        device_name: d.device_name,
        activation: d.activation,
        status: a?.ready ? "online" : "offline",
        tools: a?.ready ? a.tools : d.tools,
        platform: a?.platform,
        pi_version: a?.pi_version,
      };
    });
    return {
      account_id: account,
      registered_count: devices.length,
      online_count: devices.filter((d) => d.status === "online").length,
      devices,
    };
  }
  cancel(account: string, requestId: string) {
    const key = `${account}/${requestId}`;
    clearTimeout(this.cancelled.get(key));
    this.cancelled.set(
      key,
      setTimeout(() => this.cancelled.delete(key), 320000),
    );
    const p = this.pending.get(requestId);
    if (!p || p.account !== account) return;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.reject(
      Error(
        "Operation cancelled; execution outcome may be unknown. Do not retry automatically.",
      ),
    );
    this.cancelOnDevice(p.socket, requestId);
  }
  private cancelOnDevice(ws: WebSocket, requestId: string) {
    try {
      ws.send(JSON.stringify({ type: "cancel", request_id: requestId }));
    } catch {
      this.fail(ws);
      ws.close(1011, "Cancellation delivery failed");
    }
  }
  async call(
    account: string,
    id: string,
    name: string,
    args: Record<string, unknown>,
    requestId = crypto.randomUUID(),
  ) {
    const key = `${account}/${requestId}`;
    if (this.cancelled.has(key))
      throw Error("Operation cancelled before dispatch; not executed.");
    const ws = (await this.sockets()).find((ws) => {
      const a = ws.deserializeAttachment() as Attachment;
      return a.account === account && a.id === id && a.ready;
    });
    if (!ws) throw Error("Target device offline or unknown; call list_devices");
    const a = ws.deserializeAttachment() as Attachment;
    const d = (await this.registered(account)).find((d) => d.device_id === id)!;
    if (!a.tools.includes(name) || !(d.tools as string[]).includes(name))
      throw Error("Tool not allowed on target device");
    if (this.cancelled.has(key))
      throw Error("Operation cancelled before dispatch; not executed.");
    if (this.pending.has(requestId)) throw Error("Duplicate request ID");
    // Forward all calls; the device owns FIFO scheduling and its total deadline.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.cancelOnDevice(ws, requestId);
        reject(
          Error(
            "Device response timed out; outcome unknown. Do not retry automatically.",
          ),
        );
      }, 310000);
      this.pending.set(requestId, {
        account,
        socket: ws,
        resolve,
        reject,
        timer,
      });
      try {
        ws.send(
          JSON.stringify({
            type: "call",
            account_id: account,
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
}
