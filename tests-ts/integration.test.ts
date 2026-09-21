import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import { startGateway } from "../build/gateway.js";
import { startAgent } from "../build/agent.js";
import {
  gatewaySchema,
  agentSchema,
  savePrivate,
  token,
} from "../build/config.js";
import { checkPath, executor, piVersion } from "../build/pi.js";
import { Runner } from "../build/runner.js";

async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as any).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await sleep(30);
  }
  assert.fail("Timed out waiting for device");
}
async function authorize(base: string, owner: string) {
  const registered = await fetch(base + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Integration test",
      redirect_uris: ["https://chatgpt.com/test-callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registered.status, 201, await registered.clone().text());
  const client = (await registered.json()) as any;
  const verifier = token();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: client.redirect_uris[0],
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "pi:tools",
    resource: base + "/mcp",
    state: "test-state",
  });
  const authorization = await fetch(base + "/authorize?" + query);
  assert.equal(authorization.status, 200);
  const html = await authorization.text();
  assert(!html.includes(owner));
  const request = html.match(/name="request" value="([^"]+)"/)![1];
  const cookie = authorization.headers.get("set-cookie")!.split(";")[0];
  const submit = (key: string, origin = base, cookies = cookie) =>
    fetch(base + "/approve", {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
        cookie: cookies,
      },
      body: new URLSearchParams({ request, owner_key: key }),
    });
  assert.equal((await submit(owner, "https://evil.example")).status, 403);
  assert.equal((await submit(owner, base, "")).status, 403);
  assert.equal((await submit("incorrect")).status, 403);
  const approval = await submit(owner);
  assert.equal(approval.status, 302);
  const redirect = new URL(approval.headers.get("location")!);
  assert.equal(redirect.searchParams.get("state"), "test-state");
  const code = redirect.searchParams.get("code")!;
  const exchange = (v: string) =>
    fetch(base + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        code_verifier: v,
        redirect_uri: client.redirect_uris[0],
        resource: base + "/mcp",
      }),
    });
  assert.equal((await exchange(token())).status, 400);
  const exchanged = await exchange(verifier);
  assert.equal(exchanged.status, 200, await exchanged.clone().text());
  const tokens = (await exchanged.json()) as any;
  assert.equal(
    (await exchange(verifier)).status,
    400,
    "code must be single-use",
  );
  return { client, tokens };
}

test("Personal OAuth, one tool catalog, two devices, live routing and fail-closed behavior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat2pi-test-"));
  const localRoot = join(dir, "local"),
    remoteRoot = join(dir, "remote");
  mkdirSync(localRoot);
  mkdirSync(remoteRoot);
  writeFileSync(join(localRoot, "identity.txt"), "LOCAL");
  writeFileSync(join(remoteRoot, "identity.txt"), "REMOTE");
  const owner = token(),
    remoteToken = token();
  savePrivate(join(dir, "owner"), owner);
  const port = await freePort(),
    base = `http://127.0.0.1:${port}`;
  const config = gatewaySchema.parse({
    public_url: base,
    port,
    owner_key_file: join(dir, "owner"),
    oauth_state_file: join(dir, "oauth"),
    local_device: {
      device_id: "local",
      workspace: localRoot,
      tools: ["read", "write", "edit", "ls", "find", "grep"],
      access: "workspace",
    },
    devices: [
      { device_id: "remote", token: remoteToken, tools: ["read", "ls"] },
    ],
  });
  const gateway = await startGateway(config);
  let agent: ReturnType<typeof startAgent> | undefined;
  try {
    const unauth = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(unauth.status, 401);
    assert.match(unauth.headers.get("www-authenticate")!, /resource_metadata/);
    assert.equal(
      (await fetch(base + "/.well-known/oauth-protected-resource/mcp")).status,
      200,
    );
    assert.equal(
      (
        await fetch(base + "/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${owner}` },
        })
      ).status,
      401,
    );
    const { client, tokens } = await authorize(base, owner);
    const mcp = async (method: string, params: any = {}) => {
      const res = await fetch(base + "/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      assert.equal(res.status, 200, await res.clone().text());
      return (await res.json()) as any;
    };
    const tools = (await mcp("tools/list")).result.tools;
    assert.equal(tools.length, 8);
    for (const t of tools.filter((t: any) => t.name !== "list_devices"))
      assert(t.inputSchema.required.includes("device_id"));
    const call = async (name: string, args: any) =>
      (await mcp("tools/call", { name, arguments: args })).result;
    assert.equal(
      (await call("list_devices", {})).structuredContent.online_count,
      1,
    );
    assert.equal((await call("read", { path: "identity.txt" })).isError, true);
    assert.equal(
      (await call("read", { device_id: "absent", path: "identity.txt" }))
        .isError,
      true,
    );
    assert.equal(
      (await call("read", { device_id: "local", path: "identity.txt" }))
        .content[0].text,
      "LOCAL",
    );
    assert.equal(
      (await call("read", { device_id: "local", path: "../owner" })).isError,
      true,
    );
    agent = startAgent(
      agentSchema.parse({
        gateway_url: base,
        device_token: remoteToken,
        device: {
          device_id: "remote",
          workspace: remoteRoot,
          tools: ["read", "ls", "write"],
          access: "workspace",
        },
      }),
    );
    await waitFor(() => gateway.registry.remotes.has("remote"));
    const list = (await call("list_devices", {})).structuredContent;
    assert.equal(list.online_count, 2);
    assert.equal(
      list.devices.find((d: any) => d.device_id === "remote").pi_version,
      piVersion,
    );
    assert.equal(
      (await call("read", { device_id: "remote", path: "identity.txt" }))
        .content[0].text,
      "REMOTE",
    );
    assert.equal(
      (
        await call("write", {
          device_id: "remote",
          path: "identity.txt",
          content: "wrong",
        })
      ).isError,
      true,
    );
    assert.equal(
      readFileSync(join(remoteRoot, "identity.txt"), "utf8"),
      "REMOTE",
    );
    const written = await call("write", {
      device_id: "local",
      path: "new.txt",
      content: "test",
    });
    assert(!written.isError, JSON.stringify(written));
    assert.equal(readFileSync(join(localRoot, "new.txt"), "utf8"), "test");
    const edited = await call("edit", {
      device_id: "local",
      path: "new.txt",
      edits: [{ oldText: "test", newText: "edited" }],
    });
    assert(!edited.isError, JSON.stringify(edited));
    assert.equal(readFileSync(join(localRoot, "new.txt"), "utf8"), "edited");
    for (const [name, args] of [
      ["ls", {}],
      ["find", { pattern: "*.txt" }],
      ["grep", { pattern: "LOCAL" }],
    ] as const) {
      const result = await call(name, { device_id: "local", ...args });
      assert(!result.isError, JSON.stringify(result));
    }
    agent.close();
    await waitFor(() => !gateway.registry.remotes.has("remote"));
    assert.equal(
      (await call("read", { device_id: "remote", path: "identity.txt" }))
        .isError,
      true,
    );
    const refresh = await fetch(base + "/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.client_id,
        refresh_token: tokens.refresh_token,
        resource: base + "/mcp",
      }),
    });
    assert.equal(refresh.status, 200, await refresh.clone().text());
    const refreshed = (await refresh.json()) as any;
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
    const state = readFileSync(join(dir, "oauth"), "utf8");
    assert(!state.includes(tokens.access_token));
    assert(!state.includes(refreshed.refresh_token));
    const badSocket = new WebSocket(base.replace("http:", "ws:") + "/agent", {
      headers: { "X-Device-Id": "remote", authorization: `Bearer ${owner}` },
    });
    await new Promise<void>((resolve, reject) => {
      badSocket.on("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 401);
        badSocket.terminate();
        resolve();
      });
      badSocket.on("open", () =>
        reject(new Error("Unauthorized agent connected")),
      );
      badSocket.on("error", () => {});
    });
  } finally {
    agent?.close();
    await gateway.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Workspace path handling, symlinks, wrong device and shell timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "chat2pi-path-")),
    root = join(dir, "workspace");
  mkdirSync(root);
  writeFileSync(join(dir, "secret"), "outside");
  symlinkSync(dir, join(root, "escape"));
  symlinkSync(join(dir, "not-created"), join(root, "dangling"));
  assert.throws(() => checkPath(root, "dangling"));
  for (const path of [
    "../secret",
    "escape/secret",
    "@" + join(dir, "secret"),
    "file://" + join(dir, "secret"),
    join(dir, "secret"),
  ])
    assert.throws(() => checkPath(root, path), /outside/);
  const device = {
    device_id: "test",
    workspace: root,
    tools: ["bash", "write", "read"] as any,
    access: "unrestricted" as const,
    timeout_seconds: 30,
  };
  const runner = new Runner(device);
  try {
    await assert.rejects(
      runner.call("other", "write", { path: "bad.txt", content: "bad" }),
      /Wrong target/,
    );
    const result = await runner.call("test", "bash", {
      command: "printf chat2pi",
    });
    assert.equal(result.content[0].text, "chat2pi");
    device.timeout_seconds = 2;
    await assert.rejects(
      runner.call("test", "bash", { command: "sleep 20" }),
      /timed out/,
    );
    device.timeout_seconds = 30;
    const next = await runner.call("test", "bash", {
      command: "printf recovered",
    });
    assert.equal(next.content[0].text, "recovered");
    assert.throws(() =>
      gatewaySchema.parse({
        public_url: "https://example.com",
        owner_key_file: "x",
        oauth_state_file: "y",
        local_device: { ...device, access: "workspace" },
      }),
    );
  } finally {
    runner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
