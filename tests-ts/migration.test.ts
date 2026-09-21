import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateHome } from "../build/migration.js";
import {
  bindingPath,
  loginPath,
  bindingFiles,
  selectLogin,
} from "../build/home-store.js";
import { hash, loadAgents } from "../build/accounts.js";
import { readPrivate, savePrivate } from "../build/config.js";
const url = "https://tools.example.com";
function fixture(home: string) {
  const path = join(home, "bindings", "old.binding.json");
  const binding = {
    version: 1,
    server_url: url,
    account_id: "alice",
    device_id: "pc",
    device_name: "PC",
    device_key_sha256: hash("d".repeat(40)),
    tools: ["read", "write", "bash"],
  };
  const credentials = {
    device_key: "d".repeat(40),
    proxy_url: "http://127.0.0.1:7890",
    local: {
      workspace: home,
      access: "workspace",
      tools: ["read"],
      timeout_seconds: 12,
      shell_path: "/custom/bash",
    },
  };
  const login = {
    server_url: url,
    account_id: "alice",
    login_key: "a".repeat(40),
  };
  savePrivate(path, JSON.stringify({ ...binding, login_key: login.login_key }));
  savePrivate(path + ".credentials.json", JSON.stringify(credentials));
  const oldLogin = join(home, "accounts", "old.login.json");
  savePrivate(oldLogin, JSON.stringify(login));
  return { path, oldLogin, binding, credentials, login };
}
test("Migration splits mixed credentials, preserves local restrictions and removes only replaced files", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-migrate-"));
  try {
    const old = fixture(home);
    const download = join(home, "downloads", "pc.json");
    savePrivate(download, JSON.stringify(old));
    migrateHome(home);
    const device = bindingPath(home, url, "alice", "pc");
    const account = loginPath(home, url, "alice");
    assert.equal(selectLogin(home), account);
    assert.deepEqual(bindingFiles(home), [device]);
    assert.equal(existsSync(old.path), false);
    assert.equal(existsSync(old.path + ".credentials.json"), false);
    assert.equal(existsSync(old.oldLogin), false);
    assert(existsSync(download));
    assert(!readPrivate(device).includes(old.login.login_key));
    assert(!readPrivate(account).includes(old.credentials.device_key));
    const [agent] = loadAgents(device);
    assert.equal(agent.proxy_url, old.credentials.proxy_url);
    assert.equal(agent.device.shell_path, "/custom/bash");
    assert.equal(agent.device.timeout_seconds, 12);
    assert.equal(agent.device.workspace, home);
    assert.equal(agent.device.access, "workspace");
    assert.deepEqual(agent.device.tools, ["read"]);
    const before = readPrivate(device);
    migrateHome(home);
    assert.equal(readPrivate(device), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Conflicting destination or mismatched device key never deletes legacy credentials", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-migrate-conflict-"));
  try {
    const old = fixture(home);
    const target = loginPath(home, url, "alice");
    savePrivate(
      target,
      JSON.stringify({ ...old.login, login_key: "z".repeat(40) }),
    );
    assert.throws(() => migrateHome(home), /differs/);
    assert(existsSync(old.path));
    assert(existsSync(old.oldLogin));
    unlinkSync(target);
    savePrivate(
      old.path + ".credentials.json",
      JSON.stringify({ ...old.credentials, device_key: "z".repeat(40) }),
    );
    assert.throws(() => migrateHome(home), /mismatch/);
    assert(existsSync(old.path));
    assert(existsSync(old.oldLogin));
    assert(!existsSync(target));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
test("Interrupted deletion resumes only after verifying saved destinations", () => {
  const home = mkdtempSync(join(tmpdir(), "chat2pi-migrate-resume-"));
  try {
    const old = fixture(home);
    const account = loginPath(home, url, "alice");
    const device = bindingPath(home, url, "alice", "pc");
    savePrivate(account, JSON.stringify(old.login));
    savePrivate(
      device,
      JSON.stringify({ binding: old.binding, ...old.credentials }),
    );
    const sources = [
      old.path,
      old.path + ".credentials.json",
      old.oldLogin,
    ].map((path) => ({ path, digest: hash(readPrivate(path)) }));
    savePrivate(
      join(home, "runtime", "migration.json"),
      JSON.stringify({
        sources,
        targets: [account, device].map((path) => ({
          path,
          digest: hash(readPrivate(path)),
        })),
      }),
    );
    unlinkSync(old.path);
    migrateHome(home);
    assert(!existsSync(old.path + ".credentials.json"));
    assert(!existsSync(old.oldLogin));
    assert.equal(loadAgents(device)[0].device.device_id, "pc");
    assert(!existsSync(join(home, "runtime", "migration.json")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
