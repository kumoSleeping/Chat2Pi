import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountCommand,
  hash,
  loadAgents,
  prepareDeviceBundle,
} from "../build/accounts.js";
import { savePrivate } from "../build/config.js";
import { prepareDeviceFolder } from "../build/device-folder.js";

test("device-create saves before sending, retries with the same secret, and enables all tools by default", async () => {
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
    assert(!("login_key" in bundle));
    assert.equal(bundle.binding.account_id, "alice");
    assert(!String(init?.body).includes(bundle.device_key));
    if (!firstKey) firstKey = bundle.device_key;
    assert.equal(bundle.device_key, firstKey);
    if (++calls === 1) throw Error("network lost after registration");
    return Response.json({ binding: bundle.binding });
  };
  const options = { home: root, id: "pc", credentials, out };
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
    const devicePath = join(root, "devices", "pc.json");
    savePrivate(
      devicePath,
      JSON.stringify(
        prepareDeviceBundle(JSON.parse(readFileSync(out, "utf8")), {
          workspace,
        }),
      ),
    );
    prepareDeviceFolder(root);
    prepareDeviceFolder(root);
    const [agent] = loadAgents(devicePath);
    assert.equal(agent.device.tools.length, 7);
    assert.equal(agent.device.access, "unrestricted");
    assert(existsSync(workspace));
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
    const devicePath = join(root, "devices", "pc.json");
    savePrivate(
      devicePath,
      JSON.stringify(
        prepareDeviceBundle(JSON.parse(readFileSync(out, "utf8")), {
          workspace: join(root, "files"),
        }),
      ),
    );
    prepareDeviceFolder(root);
    const [agent] = loadAgents(devicePath);
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

test("Removed import commands give the folder workflow and do not write configurations", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { fileURLToPath } = await import("node:url");
  const exec = promisify(execFile);
  const cli = fileURLToPath(new URL("../build/cli.js", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "chat2pi-removed-"));
  try {
    for (const command of [
      "device-import",
      "login-import",
      "agent",
      "gateway-start",
    ])
      await assert.rejects(
        exec(process.execPath, [
          cli,
          command,
          "--home",
          root,
          "--bundle",
          "unused.json",
        ]),
        /command has been removed.*chat2pi folder/,
      );
    assert(!existsSync(join(root, "devices")));
    const { stdout } = await exec(process.execPath, [cli, "--help"]);
    assert.match(stdout, /folder/);
    assert(!stdout.includes("device-import"));
    assert(!stdout.includes("--all"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
