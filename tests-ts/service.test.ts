import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { homeDirectory, loginPath, selectLogin } from "../build/home-store.js";
import { savePrivate } from "../build/config.js";
const exec = promisify(execFile);
test("Home storage separates servers and refuses ambiguous account selection", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-home-"));
  try {
    const a = loginPath(home, "https://a.example", "owner"),
      b = loginPath(home, "https://b.example", "owner");
    assert.notEqual(a, b);
    savePrivate(
      a,
      JSON.stringify({
        server_url: "https://a.example",
        account_id: "owner",
        login_key: "a".repeat(64),
      }),
    );
    assert.equal(selectLogin(home), a);
    savePrivate(
      b,
      JSON.stringify({
        server_url: "https://b.example",
        account_id: "owner",
        login_key: "b".repeat(64),
      }),
    );
    assert.throws(() => selectLogin(home, "owner"), /Multiple/);
    assert.equal(selectLogin(home, "owner", "https://b.example"), b);
    assert(homeDirectory().endsWith(".chat2pi"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test(
  "Start, status, restart and stop discover bindings and control only the managed service",
  { timeout: 120000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), "chat2pi-service-"));
    const server = createServer(),
      wss = new WebSocketServer({ server });
    wss.on("connection", (ws) =>
      ws.on("message", (raw) => {
        if (raw.toString() === "ping") {
          ws.send("pong");
          return;
        }
        const msg = JSON.parse(raw.toString());
        if (msg.type === "hello")
          ws.send(JSON.stringify({ type: "ready", device_id: msg.device_id }));
      }),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const cli = resolve("build/cli.js");
    const run = async (command: string) =>
      (
        await exec(process.execPath, [cli, command, "--all", "--home", home], {
          timeout: 60000,
        })
      ).stdout;
    try {
      assert.equal(JSON.parse(await run("status")).running, false);
      await assert.rejects(run("start"), /No device bindings/);
      for (const id of ["first", "second"])
        savePrivate(
          join(home, "bindings", id + ".binding.json"),
          JSON.stringify({
            gateway_url: `http://127.0.0.1:${(server.address() as any).port}`,
            device_token: "x".repeat(64),
            device: { device_id: id, workspace: home, tools: ["read"] },
          }),
        );
      await run("start");
      const first = JSON.parse(
        readFileSync(join(home, "runtime", "service.json"), "utf8"),
      );
      assert.equal(JSON.parse(await run("status")).active_bindings.length, 2);
      await run("start");
      assert.equal(
        JSON.parse(readFileSync(join(home, "runtime", "service.json"), "utf8"))
          .id,
        first.id,
      );
      const denied = await fetch(`http://127.0.0.1:${first.port}/stop`, {
        method: "POST",
      });
      assert.equal(denied.status, 403);
      await run("restart");
      assert.notEqual(
        JSON.parse(readFileSync(join(home, "runtime", "service.json"), "utf8"))
          .id,
        first.id,
      );
      // A broken or removed profile must never prevent stopping a running service.
      writeFileSync(join(home, "bindings", "first.binding.json"), "broken");
      await run("stop");
      assert.equal(JSON.parse(await run("status")).running, false);
    } finally {
      await run("stop").catch(() => {});
      wss.clients.forEach((ws) => ws.terminate());
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(home, { recursive: true, force: true });
    }
  },
);
