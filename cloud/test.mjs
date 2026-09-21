import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const base = "https://tools.example.com",
  bootstrap = randomBytes(32).toString("hex");
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "test",
        modules: true,
        scriptPath: fileURLToPath(
          new URL("../.local/cloud-bundle/worker.js", import.meta.url),
        ),
        compatibilityDate: "2026-09-01",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          PUBLIC_URL: base,
          BOOTSTRAP_KEY_SHA256: createHash("sha256")
            .update(bootstrap)
            .digest("hex"),
        },
        kvNamespaces: ["OAUTH_KV"],
        durableObjects: {
          ROOM: { className: "DeviceRoom", useSQLite: true },
          DIRECTORY: { className: "Directory", useSQLite: true },
        },
      },
    ],
  }),
);
const request = (path, options = {}) => mf.dispatchFetch(base + path, options);
const post = (path, body, headers = {}) =>
  request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: JSON.stringify(body),
  });
async function ok(response) {
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
const headers = (login) => ({
  Authorization: "Bearer " + login.login_key,
  "X-Account-Id": login.account_id,
});
const api = (login, body) => post("/api/manage", body, headers(login));
async function getClaim(result) {
  return await ok(
    await post("/claim", { code: new URL(result.claim_url).hash.slice(1) }),
  );
}
async function change(login, body) {
  const preview = await ok(await api(login, body));
  assert.equal(preview.confirmation_required, true);
  return await ok(
    await api(login, { ...body, confirmation_id: preview.confirmation_id }),
  );
}
async function oauth(login) {
  const registered = await request("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Isolation test",
      redirect_uris: ["https://chatgpt.com/test"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registered.status, 201, await registered.clone().text());
  const client = await registered.json();
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: "https://chatgpt.com/test",
    response_type: "code",
    scope: "pi:tools",
    resource: base + "/mcp",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const page = await request("/authorize?" + query),
    html = await page.text(),
    id = html.match(/name="request" value="([^"]+)"/)[1],
    cookie = page.headers.get("set-cookie").split(";")[0];
  const consent = await request("/approve", {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: base,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      request: id,
      account_id: login.account_id,
      owner_key: login.login_key,
    }),
  });
  assert.equal(consent.status, 302, await consent.clone().text());
  const code = new URL(consent.headers.get("location")).searchParams.get(
    "code",
  );
  const token = await ok(
    await request("/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://chatgpt.com/test",
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        resource: base + "/mcp",
      }),
    }),
  );
  return token.access_token;
}
let rpcId = 0;
async function rpc(token, method, params) {
  const response = await request("/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  return response;
}
async function call(token, name, args = {}) {
  const r = await ok(await rpc(token, "tools/call", { name, arguments: args }));
  assert(!r.error, JSON.stringify(r));
  return r.result;
}
const sockets = [];
async function device(bundle, marker) {
  const b = bundle.binding;
  const r = await request("/agent", {
    headers: {
      Upgrade: "websocket",
      Authorization: "Bearer " + bundle.device_key,
      "X-Account-Id": b.account_id,
      "X-Device-Id": b.device_id,
    },
  });
  assert.equal(r.status, 101, r.status === 101 ? "" : await r.text());
  const ws = r.webSocket;
  ws.accept();
  sockets.push(ws);
  const ready = new Promise((resolve) =>
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "ready") resolve();
      if (m.type === "call") {
        assert.equal(m.account_id, b.account_id);
        ws.send(
          JSON.stringify({
            type: "result",
            request_id: m.request_id,
            result: { content: [{ type: "text", text: marker }] },
          }),
        );
      }
    }),
  );
  ws.send(
    JSON.stringify({
      type: "hello",
      protocol: 1,
      account_id: b.account_id,
      tools: b.tools,
      platform: "test",
      pi_version: "any-version",
    }),
  );
  await ready;
}
try {
  assert.equal(
    (
      await post(
        "/bootstrap",
        { account_id: "root", name: "Root" },
        { Authorization: "Bearer wrong" },
      )
    ).status,
    400,
  );
  const admin = await ok(
    await post(
      "/bootstrap",
      { account_id: "root", name: "Root" },
      { Authorization: "Bearer " + bootstrap },
    ),
  );
  assert.equal(
    (
      await post(
        "/bootstrap",
        { account_id: "thief", name: "Thief" },
        { Authorization: "Bearer " + bootstrap },
      )
    ).status,
    400,
  );
  const last = await ok(
    await api(admin, { action: "set_role", role: "member" }),
  );
  assert.equal(
    (
      await api(admin, {
        action: "set_role",
        role: "member",
        confirmation_id: last.confirmation_id,
      })
    ).status,
    400,
  );
  console.log("Bootstrap is one-time and last administrator is protected");
  const aTicket = await ok(
      await api(admin, { action: "create_account", account_id: "alice" }),
    ),
    alice = await getClaim(aTicket);
  assert.equal(
    (await post("/claim", { code: new URL(aTicket.claim_url).hash.slice(1) }))
      .status,
    400,
  );
  const bob = await getClaim(
    await ok(await api(admin, { action: "create_account", account_id: "bob" })),
  );
  assert.equal((await api(alice, { action: "list_accounts" })).status, 400);
  assert.equal(
    (
      await api(alice, {
        action: "bind_device",
        account_id: "bob",
        device_id: "stolen",
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(alice, { action: "set_role", role: "admin" })).status,
    400,
  );
  const ab = await getClaim(
    await ok(await api(alice, { action: "bind_device", device_id: "same-pc" })),
  );
  const bb = await getClaim(
    await ok(await api(bob, { action: "bind_device", device_id: "same-pc" })),
  );
  assert.notEqual(ab.device_key, bb.device_key);
  const copied = await request("/agent", {
    headers: {
      Upgrade: "websocket",
      Authorization: "Bearer " + ab.device_key,
      "X-Account-Id": "bob",
      "X-Device-Id": "same-pc",
    },
  });
  assert.equal(copied.status, 401);
  await device(ab, "ALICE ONLY");
  await device(bb, "BOB ONLY");
  const at = await oauth(alice),
    bt = await oauth(bob);
  const tools = await ok(await rpc(at, "tools/list", {}));
  assert.equal(tools.result.tools.length, 9);
  assert.equal(
    tools.result.tools.find((t) => t.name === "manage").description,
    "管理账号和设备。",
  );
  for (const [token, expected, other] of [
    [at, "ALICE ONLY", "BOB ONLY"],
    [bt, "BOB ONLY", "ALICE ONLY"],
  ]) {
    const result = await call(token, "read", {
      device_id: "same-pc",
      path: "identity.txt",
    });
    assert.match(JSON.stringify(result), new RegExp(expected));
    assert(!JSON.stringify(result).includes(other));
  }
  assert.equal(
    (await call(at, "manage", { action: "list_accounts" })).isError,
    true,
  );
  const list = JSON.parse((await call(at, "list_devices")).content[0].text);
  assert.equal(list.registered_count, 1);
  assert.equal(list.online_count, 1);
  assert.equal(list.account_id, "alice");
  const offline = await ok(
    await api(alice, { action: "bind_device", device_id: "offline-pc" }),
  );
  const list2 = JSON.parse((await call(at, "list_devices")).content[0].text);
  assert.equal(list2.registered_count, 2);
  assert.equal(list2.online_count, 1);
  console.log(
    "OAuth identities, same-named devices, online/offline lists and credentials are isolated",
  );
  const preview = await ok(
    await api(admin, {
      action: "set_role",
      account_id: "alice",
      role: "admin",
    }),
  );
  assert.equal(
    (
      await api(admin, {
        action: "set_role",
        account_id: "bob",
        role: "admin",
        confirmation_id: preview.confirmation_id,
      })
    ).status,
    400,
  );
  await ok(
    await api(admin, {
      action: "set_role",
      account_id: "alice",
      role: "admin",
      confirmation_id: preview.confirmation_id,
    }),
  );
  await ok(await api(alice, { action: "list_accounts" }));
  await change(admin, {
    action: "set_role",
    account_id: "alice",
    role: "member",
  });
  assert.equal((await api(alice, { action: "list_accounts" })).status, 400);
  await change(alice, { action: "unbind_device", device_id: "same-pc" });
  assert.equal(
    (await call(at, "read", { device_id: "same-pc", path: "identity.txt" }))
      .isError,
    true,
  );
  await change(admin, { action: "disable_account", account_id: "bob" });
  assert.equal((await rpc(bt, "tools/list", {})).status, 401);
  assert.equal((await api(bob, { action: "me" })).status, 401);
  const rotate = await change(alice, { action: "rotate_login" });
  const alice2 = await getClaim(rotate);
  assert.equal((await rpc(at, "tools/list", {})).status, 401);
  assert.equal((await api(alice, { action: "me" })).status, 401);
  await ok(await api(alice2, { action: "me" }));
  assert.equal(
    (await post("/claim", { code: new URL(offline.claim_url).hash.slice(1) }))
      .status,
    400,
  );
  console.log(
    "Confirmation binding, live role changes, revocation and OAuth rotation verified",
  );
} finally {
  for (const ws of sockets)
    try {
      ws.close();
    } catch {}
  await mf.dispose();
}
