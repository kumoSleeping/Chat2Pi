import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDeviceFolder } from "../build/device-folder.js";
import { prepareDeviceBundle, hash, loadAgents } from "../build/accounts.js";
import { bindingPath } from "../build/home-store.js";
import { savePrivate } from "../build/config.js";
const url = "https://tools.example.com";
const bundle = {
  binding: {
    version: 1,
    server_url: url,
    account_id: "alice",
    device_id: "pc",
    device_name: "PC",
    device_key_sha256: hash("x".repeat(40)),
    tools: ["read", "write", "bash"],
  },
  device_key: "x".repeat(40),
};
test("Dropping another copy preserves installed local restrictions and removes only the duplicate", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-folder-"));
  try {
    const installed = bindingPath(home, url, "alice", "pc");
    savePrivate(
      installed,
      JSON.stringify(
        prepareDeviceBundle(bundle, { workspace: home, access: "read" }),
      ),
    );
    const copy = join(home, "devices", "pc.json");
    writeFileSync(copy, JSON.stringify(bundle), { mode: 0o644 });
    prepareDeviceFolder(home);
    assert(!existsSync(copy));
    assert.deepEqual(loadAgents(installed)[0].device.tools, ["read"]);
    assert(!existsSync(join(home, "accounts")));
    prepareDeviceFolder(home);
    assert.deepEqual(loadAgents(installed)[0].device.tools, ["read"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Invalid or account files never get silently imported as a device", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-folder-invalid-"));
  try {
    mkdirSync(join(home, "devices"));
    const file = join(home, "devices", "wrong.json");
    writeFileSync(
      file,
      JSON.stringify({ ...bundle, device_key: "z".repeat(40) }),
    );
    assert.throws(() => prepareDeviceFolder(home), /Invalid device bundle/);
    const account = JSON.stringify({
      server_url: url,
      account_id: "alice",
      login_key: "a".repeat(40),
    });
    writeFileSync(file, account);
    assert.throws(
      () => prepareDeviceFolder(home),
      /Account credentials belong outside/,
    );
    assert.equal(readFileSync(file, "utf8"), account);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test(
  "Start loads a downloaded device file without any account file or import command",
  { timeout: 30000 },
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { resolve } = await import("node:path");
    const exec = promisify(execFile);
    const home = mkdtempSync(join(tmpdir(), "chat2pi-drop-start-"));
    const cli = resolve("build/cli.js");
    const run = (command: string, ...args: string[]) =>
      exec(process.execPath, [cli, command, "--home", home, ...args], {
        timeout: 20000,
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
    try {
      mkdirSync(join(home, "devices"));
      const file = join(home, "devices", "pc.json");
      writeFileSync(
        file,
        JSON.stringify({
          ...bundle,
          binding: { ...bundle.binding, server_url: "https://127.0.0.1:1" },
        }),
        { mode: 0o644 },
      );
      await run("start", "--background");
      assert.equal(JSON.parse((await run("status")).stdout).running, true);
      assert.equal(
        loadAgents(file)[0].device.workspace,
        join(home, "PiWorkspace"),
      );
      assert(!existsSync(join(home, "accounts")));
    } finally {
      await run("stop").catch(() => {});
      rmSync(home, { recursive: true, force: true });
    }
  },
);
