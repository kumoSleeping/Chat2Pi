import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { hash, loadAgents } from "../build/accounts.js";
import { startAgent } from "../build/agent.js";
import { token } from "../build/config.js";

test("One account/device per binding; local credentials and tool restrictions are enforced", () => {
  const root = mkdtempSync(join(tmpdir(), "chat2pi-binding-"));
  try {
    const key = token(),
      path = join(root, "alice--pc.json");
    const binding = {
      version: 1,
      server_url: "https://tools.example.com",
      account_id: "alice",
      device_id: "pc",
      device_name: "PC",
      device_key_sha256: hash(key),
      tools: ["read", "bash"],
    };
    writeFileSync(path, JSON.stringify(binding), { mode: 0o600 });
    const local = {
      device_key: key,
      local: { workspace: root, access: "workspace", tools: ["read"] },
    };
    writeFileSync(path + ".credentials.json", JSON.stringify(local), {
      mode: 0o600,
    });
    const [agent] = loadAgents(path);
    assert.equal(agent.account_id, "alice");
    assert.deepEqual(agent.device.tools, ["read"]);
    writeFileSync(
      path + ".credentials.json",
      JSON.stringify({ ...local, device_key: token() }),
      { mode: 0o600 },
    );
    assert.throws(() => loadAgents(path), /does not match/);
    writeFileSync(path, JSON.stringify({ ...binding, accounts: [] }), {
      mode: 0o600,
    });
    assert.throws(() => loadAgents(path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "The local executor rejects a call for a different account before reading files",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "chat2pi-account-call-"));
    writeFileSync(join(root, "identity.txt"), "ALICE PRIVATE");
    const server = createServer(),
      wss = new WebSocketServer({ server });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    let wrongId = "",
      rightId = "";
    const result = new Promise<void>((resolve, reject) =>
      wss.on("connection", (ws, request) => {
        try {
          assert.equal(request.headers["x-account-id"], "alice");
        } catch (e) {
          reject(e);
        }
        ws.on("message", (raw) => {
          try {
            const m = JSON.parse(raw.toString());
            if (m.type === "hello") {
              assert.equal(m.account_id, "alice");
              wrongId = crypto.randomUUID();
              rightId = crypto.randomUUID();
              ws.send(
                JSON.stringify({
                  type: "call",
                  request_id: wrongId,
                  account_id: "bob",
                  device_id: "pc",
                  name: "read",
                  arguments: { path: "identity.txt" },
                }),
              );
            } else if (m.request_id === wrongId) {
              assert.match(m.error, /Wrong account/);
              assert(!JSON.stringify(m).includes("ALICE PRIVATE"));
              ws.send(
                JSON.stringify({
                  type: "call",
                  request_id: rightId,
                  account_id: "alice",
                  device_id: "pc",
                  name: "read",
                  arguments: { path: "identity.txt" },
                }),
              );
            } else if (m.request_id === rightId) {
              assert.match(JSON.stringify(m.result), /ALICE PRIVATE/);
              resolve();
            }
          } catch (e) {
            reject(e);
          }
        });
      }),
    );
    const agent = startAgent({
      gateway_url: `http://127.0.0.1:${(server.address() as any).port}`,
      account_id: "alice",
      device_token: token(),
      device: {
        device_id: "pc",
        workspace: root,
        tools: ["read"],
        access: "workspace",
        timeout_seconds: 5,
      },
    });
    try {
      await result;
    } finally {
      agent.close();
      wss.clients.forEach((ws) => ws.terminate());
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
