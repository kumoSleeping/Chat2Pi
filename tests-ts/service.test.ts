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
        await exec(
          process.execPath,
          [
            cli,
            command,
            ...(["start", "restart"].includes(command) ? ["--background"] : []),
            "--home",
            home,
          ],
          {
            timeout: 60000,
          },
        )
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

test(
  "Plain start polls live logs, refuses duplicate ownership, and disconnects on stop",
  { timeout: 45000 },
  async () => {
    const { spawn } = await import("node:child_process");
    const { once } = await import("node:events");
    const home = mkdtempSync(join(tmpdir(), "chat2pi-foreground-"));
    const server = createServer();
    const wss = new WebSocketServer({ server });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    savePrivate(
      join(home, "bindings", "pc.binding.json"),
      JSON.stringify({
        gateway_url: `http://127.0.0.1:${(server.address() as any).port}`,
        device_token: "x".repeat(64),
        device: { device_id: "pc", workspace: home, tools: ["read"] },
      }),
    );
    const connected = new Promise<any>((resolve) =>
      wss.once("connection", (ws) => {
        ws.on("message", (raw) => {
          if (JSON.parse(raw.toString()).type === "hello") {
            ws.send(JSON.stringify({ type: "ready", device_id: "pc" }));
            resolve(ws);
          }
        });
      }),
    );
    const cli = resolve("build/cli.js");
    const child = spawn(process.execPath, [cli, "start", "--home", home], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const run = (command: string) =>
      exec(process.execPath, [cli, command, "--home", home], {
        timeout: 10000,
      });
    try {
      const ws = await connected;
      for (let n = 0; n < 100 && !output.includes("Device online: pc"); n++)
        await new Promise((r) => setTimeout(r, 50));
      assert.match(output, /Device online: pc/);
      assert.match(output, /Ctrl\+C/);
      await assert.rejects(run("start"), /already running/);
      assert.equal(JSON.parse((await run("status")).stdout).running, true);
      const disconnected = once(ws, "close");
      // Node cannot synthesize a console Ctrl+C on Windows; exercise its same
      // authenticated shutdown endpoint there. Real console acceptance is separate.
      if (process.platform === "win32") await run("stop");
      else child.kill("SIGINT");
      await disconnected;
      const [code] = await exited;
      assert.equal(code, 0, output);
      assert.equal(JSON.parse((await run("status")).stdout).running, false);
    } finally {
      await run("stop").catch(() => {});
      child.kill();
      wss.clients.forEach((ws) => ws.terminate());
      await new Promise<void>((r) => wss.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(home, { recursive: true, force: true });
    }
  },
);
