import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountCommand, hash, loadAgents } from "../build/accounts.js";
import { savePrivate } from "../build/config.js";
import { bindingPath } from "../build/home-store.js";

test("device-create saves before sending, retries with the same secret, and imports explicit full access", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat2pi-create-"));
  const originalFetch = globalThis.fetch;
  const login = {
    server_url: "https://tools.example.com",
    account_id: "alice",
    login_key: "a".repeat(40),
  };
  const credentials = join(root, "login.json"),
    out = join(root, "pc.json");
  savePrivate(credentials, JSON.stringify(login));
  let firstKey = "",
    calls = 0;
  globalThis.fetch = async (_url, init) => {
    const bundle = JSON.parse(readFileSync(out, "utf8"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.device_key_sha256, hash(bundle.device_key));
    assert(!String(init?.body).includes(bundle.device_key));
    if (!firstKey) firstKey = bundle.device_key;
    assert.equal(bundle.device_key, firstKey);
    if (++calls === 1) throw Error("network lost after registration");
    return Response.json({ binding: bundle.binding });
  };
  const options = { home: root, id: "pc", credentials, out, access: "full" };
  try {
    await assert.rejects(
      accountCommand("device-create", options),
      /file preserved/,
    );
    await accountCommand("device-create", options);
    await accountCommand("device-create", options);
    await assert.rejects(
      accountCommand("device-create", { ...options, access: "read" }),
      /different device/,
    );
    assert.equal(calls, 3);
    const workspace = join(root, "workspace");
    await assert.rejects(
      accountCommand("device-import", { home: root, bundle: out, workspace }),
      /Confirm on this computer/,
    );
    assert(!existsSync(workspace));
    const imp = { home: root, bundle: out, workspace, access: "full" };
    await accountCommand("device-import", imp);
    await accountCommand("device-import", imp);
    const [agent] = loadAgents(
      bindingPath(root, login.server_url, "alice", "pc"),
    );
    assert.equal(agent.device.tools.length, 7);
    assert.equal(agent.device.access, "unrestricted");
    assert(existsSync(workspace));
    await assert.rejects(
      accountCommand("device-import", { ...imp, access: "read" }),
      /differ/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace export preserves file editing without granting shell or whole-computer access", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat2pi-workspace-"));
  const originalFetch = globalThis.fetch;
  const credentials = join(root, "login.json"),
    out = join(root, "pc.json");
  savePrivate(
    credentials,
    JSON.stringify({
      server_url: "https://tools.example.com",
      account_id: "alice",
      login_key: "a".repeat(40),
    }),
  );
  globalThis.fetch = async () =>
    Response.json({ binding: JSON.parse(readFileSync(out, "utf8")).binding });
  try {
    await accountCommand("device-create", {
      home: root,
      id: "pc",
      credentials,
      out,
      access: "workspace",
    });
    await accountCommand("device-import", {
      home: root,
      bundle: out,
      workspace: join(root, "files"),
    });
    const [agent] = loadAgents(
      bindingPath(root, "https://tools.example.com", "alice", "pc"),
    );
    assert.equal(agent.device.access, "workspace");
    assert(agent.device.tools.includes("write"));
    assert(!agent.device.tools.includes("bash"));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("manage forwards requested tools; local save failure never creates a remote binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "chat2pi-tools-"));
  const originalFetch = globalThis.fetch;
  const credentials = join(root, "login.json");
  savePrivate(
    credentials,
    JSON.stringify({
      server_url: "https://tools.example.com",
      account_id: "alice",
      login_key: "a".repeat(40),
    }),
  );
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)).tools, [
      "read",
      "write",
      "bash",
    ]);
    return Response.json({ ok: true });
  };
  try {
    await accountCommand("manage", {
      credentials,
      action: "bind_device",
      id: "pc",
      tools: "read, write,bash",
    });
    await assert.rejects(
      accountCommand("device-create", {
        credentials,
        id: "pc",
        out: join(credentials, "pc.json"),
      }),
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "device-import --start loads the new binding into the background service",
  { timeout: 45000 },
  async () => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { fileURLToPath } = await import("node:url");
    const run = promisify(execFile);
    const cli = fileURLToPath(new URL("../build/cli.js", import.meta.url));
    const root = mkdtempSync(join(tmpdir(), "chat2pi-import-start-"));
    const bundle = join(root, "pc.json"),
      deviceKey = "z".repeat(40);
    savePrivate(
      bundle,
      JSON.stringify({
        binding: {
          version: 1,
          server_url: "https://127.0.0.1:1",
          account_id: "alice",
          device_id: "pc",
          device_name: "pc",
          device_key_sha256: hash(deviceKey),
          tools: ["read"],
        },
        device_key: deviceKey,
      }),
    );
    try {
      await run(
        process.execPath,
        [
          cli,
          "device-import",
          "--home",
          root,
          "--bundle",
          bundle,
          "--workspace",
          join(root, "work"),
          "--start",
        ],
        { timeout: 35000 },
      );
      const { stdout } = await run(process.execPath, [
        cli,
        "status",
        "--home",
        root,
      ]);
      const status = JSON.parse(stdout);
      assert.equal(status.running, true);
      assert.equal(status.active_bindings[0].device_id, "pc");
    } finally {
      try {
        await run(process.execPath, [cli, "stop", "--home", root], {
          timeout: 10000,
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
);
