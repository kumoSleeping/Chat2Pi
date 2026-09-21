// Network probe only: no local tools, file access, upstream fetching or storage.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz")
      return Response.json({ service: "chat2pi-ws-probe" });
    if (url.pathname !== "/ws")
      return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let count = 0;
    server.addEventListener("message", (event) => {
      if (
        typeof event.data !== "string" ||
        event.data.length > 1024 ||
        ++count > 100
      ) {
        server.close(1008, "Probe limit");
        return;
      }
      server.send(event.data);
    });
    server.addEventListener("error", () => server.close(1011, "Probe error"));
    return new Response(null, { status: 101, webSocket: client });
  },
};
