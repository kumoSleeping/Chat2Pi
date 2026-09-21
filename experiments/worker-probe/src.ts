import { DurableObject } from "cloudflare:workers";

// Cloud-only probe. No local tools, file access, upstream fetches or stored data.
export class ProbeRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ count: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    const state = socket.deserializeAttachment() as { count: number };
    if (typeof data !== "string" || data.length > 1024 || ++state.count > 100) {
      socket.close(1008, "Probe limit");
      return;
    }
    socket.serializeAttachment(state);
    socket.send(data);
  }
  webSocketClose(socket: WebSocket, code: number) {
    socket.close(code === 1005 || code === 1006 ? 1000 : code);
  }
  webSocketError(socket: WebSocket) {
    socket.close(1011, "Probe error");
  }
}
export default {
  async fetch(
    request: Request,
    env: { ROOM: DurableObjectNamespace; PROBE_ENABLED?: string },
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (env.PROBE_ENABLED !== "true")
      return new Response("Network probe disabled", { status: 410 });
    if (path === "/healthz")
      return Response.json({
        service: "chat2pi-ws-probe",
        backend: "durable-object",
      });
    if (path !== "/ws") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    return env.ROOM.getByName("network-test").fetch(request);
  },
};
