import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
const credentials = JSON.parse(
  readFileSync(
    process.argv[2] || new URL("../.local/kumo.login.json", import.meta.url),
    "utf8",
  ),
);
const base = credentials.server_url;
const owner = credentials.login_key;
const deviceId = process.argv[3] || "kumo-macBook-m2";
const random = () => randomBytes(32).toString("base64url");
const req = async (path, options = {}) =>
  fetch(base + path, { ...options, signal: AbortSignal.timeout(25000) });
let r = await req("/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(r.status, 401);
console.log("Unauthenticated MCP rejected");
r = await req("/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "Chat2Pi integration verification",
    redirect_uris: ["https://chatgpt.com/test-callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }),
});
assert.equal(r.status, 201, await r.clone().text());
const client = await r.json();
const verifier = random();
const query = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: "https://chatgpt.com/test-callback",
  response_type: "code",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  scope: "pi:tools",
  resource: base + "/mcp",
  state: "smoke",
});
r = await req("/authorize?" + query);
assert.equal(r.status, 200, await r.clone().text());
const page = await r.text();
const id = page.match(/name="request" value="([^"]+)"/)[1];
const cookie = r.headers.get("set-cookie").split(";")[0];
const consent = (key, origin = base) =>
  req("/approve", {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      request: id,
      account_id: credentials.account_id,
      owner_key: key,
    }),
  });
assert.equal((await consent(owner, "https://invalid.example")).status, 403);
assert.equal((await consent("wrong")).status, 403);
r = await consent(owner);
assert.equal(r.status, 302, await r.clone().text());
const code = new URL(r.headers.get("location")).searchParams.get("code");
assert.equal((await consent(owner)).status, 403);
const exchange = (v) =>
  req("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.com/test-callback",
      code,
      code_verifier: v,
      resource: base + "/mcp",
    }),
  });
assert.equal((await exchange(random())).status, 400);
r = await exchange(verifier);
assert.equal(r.status, 200, await r.clone().text());
let tokens = await r.json();
console.log("OAuth consent, CSRF and PKCE checks passed");
let seq = 0;
async function rpc(method, params) {
  const r = await req("/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokens.access_token,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
  });
  const text = await r.text();
  assert.equal(r.status, 200, text);
  const data = JSON.parse(text);
  assert(!data.error, JSON.stringify(data));
  return data.result;
}
await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "cloud-smoke", version: "1" },
});
const tools = await rpc("tools/list", {});
assert.equal(tools.tools.length, 9);
const list = await rpc("tools/call", { name: "list_devices", arguments: {} });
const devices = JSON.parse(list.content[0].text);
assert(
  devices.devices.some(
    (d) => d.device_id === deviceId && d.status === "online",
  ),
  JSON.stringify(devices),
);
console.log("Nine tools and correct online device confirmed");
const identity = await rpc("tools/call", {
  name: "manage",
  arguments: { action: "me" },
});
assert.equal(
  JSON.parse(identity.content[0].text).account_id,
  credentials.account_id,
);
console.log("MCP manage identity verified");
const read = await rpc("tools/call", {
  name: "read",
  arguments: { device_id: deviceId, path: "README.md", limit: 3 },
});
assert(!read.isError, JSON.stringify(read));
assert.match(JSON.stringify(read), /Chat2Pi/);
console.log("Real Pi read returned through Cloudflare");
const wrong = await rpc("tools/call", {
  name: "read",
  arguments: { device_id: "not-registered", path: "README.md" },
});
assert.equal(wrong.isError, true);
console.log("Wrong device refused");
r = await req("/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: client.client_id,
    refresh_token: tokens.refresh_token,
    resource: base + "/mcp",
  }),
});
assert.equal(r.status, 200, await r.clone().text());
tokens = await r.json();
await rpc("tools/list", {});
console.log("Refreshed access token works");
writeFileSync(
  new URL("../.local/cloud-smoke-client.json", import.meta.url),
  JSON.stringify({ base, client, tokens }),
  { mode: 0o600 },
);
