import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { WebSocketServer } from "ws";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAgent } from "../build/agent.js";
import { agentSchema, token } from "../build/config.js";
import { Runner } from "../build/runner.js";

test(
  "Device connects through an explicit HTTP proxy and executes on the target",
  { timeout: 60000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "chat2pi-proxy-"));
    writeFileSync(join(root, "identity.txt"), "PROXIED DEVICE");
    const upstream = createServer();
    const ws = new WebSocketServer({ server: upstream });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const target = (upstream.address() as any).port;
    const sockets = new Set<Socket>();
    const proxy = createServer();
    let connects = 0;
    proxy.on("connect", (req, downstream, head) => {
      assert.equal(req.url, `127.0.0.1:${target}`);
      connects++;
      const remote = connect(target, "127.0.0.1", () => {
        downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) remote.write(head);
        downstream.pipe(remote);
        remote.pipe(downstream);
      });
      for (const s of [remote, downstream]) {
        sockets.add(s as Socket);
        s.on("error", () => {});
        s.on("close", () => sockets.delete(s as Socket));
      }
      downstream.on("close", () => remote.destroy());
      remote.on("close", () => downstream.destroy());
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const credential = token();
    const result = new Promise<any>((resolve, reject) =>
      ws.on("connection", (socket, req) => {
        try {
          assert.equal(req.headers.authorization, `Bearer ${credential}`);
        } catch (e) {
          reject(e);
          return;
        }
        socket.on("message", (raw) => {
          if (raw.toString() === "ping") {
            socket.send("pong");
            return;
          }
          const message = JSON.parse(raw.toString());
          if (message.type === "hello")
            socket.send(
              JSON.stringify({
                type: "call",
                request_id: crypto.randomUUID(),
                device_id: "proxy-device",
                name: "read",
                arguments: { path: "identity.txt" },
              }),
            );
          if (message.type === "result") resolve(message);
        });
      }),
    );
    const agent = startAgent(
      agentSchema.parse({
        gateway_url: `http://127.0.0.1:${target}`,
        device_token: credential,
        proxy_url: `http://127.0.0.1:${(proxy.address() as any).port}`,
        device: { device_id: "proxy-device", workspace: root, tools: ["read"] },
      }),
    );
    try {
      const response = await result;
      assert.equal(connects, 1);
      assert.equal(response.error, undefined);
      assert.match(JSON.stringify(response.result), /PROXIED DEVICE/);
    } finally {
      agent.close();
      for (const s of sockets) s.destroy();
      for (const s of ws.clients) s.terminate();
      await Promise.all([
        new Promise<void>((r) => ws.close(() => r())),
        new Promise<void>((r) => upstream.close(() => r())),
        new Promise<void>((r) => proxy.close(() => r())),
      ]);
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "Configured bash executable reaches the tool worker",
  { skip: process.platform === "win32" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "chat2pi-shell-"));
    const shell = join(root, "custom-bash");
    writeFileSync(shell, '#!/bin/sh\nprintf "CUSTOM_SHELL_OK"\n', {
      mode: 0o700,
    });
    const runner = new Runner({
      device_id: "shell-device",
      workspace: root,
      tools: ["bash"],
      access: "unrestricted",
      timeout_seconds: 30,
      shell_path: shell,
    });
    try {
      const result = await runner.call("shell-device", "bash", {
        command: "ignored by test shell",
      });
      assert.match(JSON.stringify(result), /CUSTOM_SHELL_OK/);
    } finally {
      runner.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
