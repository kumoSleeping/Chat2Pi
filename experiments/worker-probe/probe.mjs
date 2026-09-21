import { WebSocket } from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";

const origin = new URL(process.argv[2]);
if (origin.protocol !== "https:") throw Error("HTTPS required");
origin.protocol = "wss:";
origin.pathname = "/ws";
const results = [];
function report(route, event, extra = {}) {
  const r = { route, event, ...extra };
  results.push(r);
  console.log(JSON.stringify(r));
}
async function open(agent) {
  const ws = new WebSocket(origin, {
    agent,
    handshakeTimeout: 15000,
    maxPayload: 2048,
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.terminate();
      reject(Error("open timeout"));
    }, 16000);
    ws.once("open", () => {
      clearTimeout(t);
      resolve();
    });
    ws.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
  ws.on("error", () => {});
  return ws;
}
async function echo(ws, label) {
  const data = JSON.stringify({
    probe: "chat2pi-network-only",
    id: crypto.randomUUID(),
    label,
  });
  const start = Date.now();
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(t);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      error ? reject(error) : resolve();
    };
    const onMessage = (b) =>
      finish(b.toString() === data ? undefined : Error("echo mismatch"));
    const onClose = () => finish(Error("connection closed"));
    const t = setTimeout(() => finish(Error("echo timeout")), 10000);
    ws.once("message", onMessage);
    ws.once("close", onClose);
    ws.send(data, (e) => {
      if (e) finish(e);
    });
  });
  return Date.now() - start;
}
async function run(route, proxy) {
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  let ws;
  try {
    ws = await open(agent);
    report(route, "connected");
    report(route, "echo", { ms: await echo(ws, "initial") });
    await sleep(35000);
    report(route, "idle-35s-echo", { ms: await echo(ws, "after-idle") });
    ws.terminate();
    ws = await open(agent);
    report(route, "reconnected");
    report(route, "reconnect-echo", { ms: await echo(ws, "after-reconnect") });
    report(route, "PASS");
  } catch (e) {
    report(route, "FAIL", { error: e.message });
  } finally {
    ws?.terminate();
    agent?.destroy();
  }
}
await Promise.all([
  run("system-routing-TUN"),
  run("explicit-http-proxy", "http://127.0.0.1:7890"),
]);
if (process.argv[3])
  writeFileSync(
    process.argv[3],
    JSON.stringify(
      { at: new Date().toISOString(), origin: origin.origin, results },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
if (results.some((r) => r.event === "FAIL")) process.exitCode = 1;
