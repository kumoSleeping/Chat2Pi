#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  gatewaySchema,
  agentSchema,
  deviceId,
  readConfig,
  readPrivate,
  savePrivate,
  token,
  requireSecureUrl,
  toolNames,
} from "./config.js";
import { startGateway } from "./gateway.js";
import { startAgent } from "./agent.js";
import { piVersion } from "./pi.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string", short: "c" },
    url: { type: "string" },
    id: { type: "string" },
    workspace: { type: "string" },
    out: { type: "string" },
    cloudflare: { type: "string" },
    unrestricted: { type: "boolean", default: false },
    port: { type: "string" },
  },
});
const configFile = resolve(values.config ?? ".local/gateway.json");
const cli = fileURLToPath(import.meta.url);
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const device = (id: string, workspace: string) => ({
  device_id: deviceId.parse(id),
  workspace,
  tools: values.unrestricted ? [...toolNames] : ["read", "ls", "find", "grep"],
  access: values.unrestricted ? "unrestricted" : "workspace",
  timeout_seconds: 60,
});
function fingerprint(pid: number): string {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart=,command="], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}
function daemonState() {
  const path = configFile + ".process";
  if (!existsSync(path)) return undefined;
  const state = JSON.parse(readFileSync(path, "utf8"));
  if (!Number.isSafeInteger(state.pid) || state.pid < 2 || !state.identity)
    return undefined;
  return fingerprint(state.pid) === state.identity ? state : undefined;
}
async function probeHealth(origin: string): Promise<string> {
  try {
    const response = await fetch(origin + "/healthz", {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) return "unavailable (HTTP " + response.status + ")";
    const data = (await response.json()) as { service?: string };
    return data.service === "chat2pi" ? "reachable" : "unexpected service";
  } catch {
    return "unreachable";
  }
}
async function main() {
  const command = positionals[0];
  if (command === "init") {
    if (existsSync(configFile))
      throw new Error("Config already exists; not overwritten");
    if (!values.url || !values.id)
      throw new Error("init requires --url and --id");
    const origin = requireSecureUrl(values.url).origin;
    const dir = dirname(configFile);
    const owner = resolve(dir, "owner-key");
    if (!existsSync(owner)) savePrivate(owner, token() + "\n");
    const config = gatewaySchema.parse({
      public_url: origin,
      port: Number(values.port ?? 8787),
      owner_key_file: owner,
      oauth_state_file: resolve(dir, "oauth-state.json"),
      local_device: device(values.id, resolve(values.workspace ?? ".")),
      devices: [],
      cloudflare_config: values.cloudflare
        ? resolve(values.cloudflare)
        : undefined,
    });
    savePrivate(configFile, json(config));
    console.log(
      `Created ${configFile}\nMCP URL: ${origin}/mcp\nPersonal authorization key file: ${owner}\nNo secrets are printed or included in the npm package.`,
    );
  } else if (command === "add-device") {
    if (!values.id || !values.workspace)
      throw new Error(
        "add-device requires --id and --workspace (a path on the new computer)",
      );
    const config = gatewaySchema.parse(readConfig(configFile));
    const id = deviceId.parse(values.id);
    if (
      config.local_device?.device_id === id ||
      config.devices.some((d) => d.device_id === id)
    )
      throw new Error("Device ID already registered");
    const out = resolve(values.out ?? `.local/${id}.json`);
    if (existsSync(out))
      throw new Error("Output file already exists; not overwritten");
    const local = device(id, values.workspace);
    const credential = token();
    const agent = agentSchema.parse({
      gateway_url: config.public_url,
      device_token: credential,
      device: local,
    });
    config.devices.push({
      device_id: id,
      token: credential,
      tools: agent.device.tools,
    });
    savePrivate(out, json(agent));
    savePrivate(configFile, json(config));
    console.log(
      `Created private device config: ${out}\nCopy only this file to the target computer. Restart the gateway to load the registration.`,
    );
  } else if (command === "run") {
    const config = gatewaySchema.parse(readConfig(configFile));
    readPrivate(configFile);
    const gateway = await startGateway(config);
    let tunnel: ChildProcess | undefined;
    let stopping = false;
    const shutdown = async (code = 0) => {
      if (stopping) return;
      stopping = true;
      tunnel?.kill("SIGTERM");
      await gateway.close();
      process.exit(code);
    };
    if (config.cloudflare_config) {
      const args = ["tunnel", "--config", config.cloudflare_config];
      tunnel = spawn("cloudflared", [...args, "run"], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      tunnel.once("error", () => {
        console.error("cloudflared failed to start");
        void shutdown(1);
      });
      tunnel.once("exit", () => {
        if (!stopping) {
          console.error("Cloudflare tunnel stopped");
          void shutdown(1);
        }
      });
    }
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
    console.log(
      `Chat2Pi local gateway ready; Pi ${piVersion}; public URL ${config.public_url}/mcp (tunnel readiness is separate)`,
    );
  } else if (command === "agent") {
    readPrivate(configFile);
    const config = agentSchema.parse(readConfig(configFile));
    const agent = startAgent(config);
    const stop = () => {
      agent.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } else if (["start", "stop", "restart", "status"].includes(command)) {
    if (process.platform === "win32")
      throw new Error(
        "On Windows use run / agent in the foreground or your system service manager",
      );
    const config = gatewaySchema.parse(readConfig(configFile));
    const statePath = configFile + ".process",
      lockPath = configFile + ".lock";
    mkdirSync(dirname(configFile), { recursive: true, mode: 0o700 });
    if (command === "status") {
      console.log(
        `Gateway: ${daemonState() ? "running" : "stopped"}\nMCP URL: ${config.public_url}/mcp\nLog: ${configFile}.log`,
      );
      const checks = await Promise.all([
        probeHealth("http://127.0.0.1:" + config.port),
        probeHealth(config.public_url),
      ]);
      console.log(
        "Local health: " + checks[0] + "\nPublic health: " + checks[1],
      );
      return;
    }
    const lock = openSync(lockPath, "wx", 0o600);
    try {
      if (command === "stop" || command === "restart") {
        const state = daemonState();
        if (state) {
          process.kill(state.pid, "SIGTERM");
          for (
            let n = 0;
            n < 100 && fingerprint(state.pid) === state.identity;
            n++
          )
            await sleep(100);
          if (fingerprint(state.pid) === state.identity)
            throw new Error(
              "Gateway is still shutting down; no forced termination",
            );
        }
        if (existsSync(statePath)) unlinkSync(statePath);
        console.log("Gateway stopped");
      }
      if (command === "start" || command === "restart") {
        if (daemonState()) {
          console.log("Gateway already running");
          return;
        }
        const log = openSync(configFile + ".log", "a", 0o600);
        const child = spawn(
          process.execPath,
          [cli, "run", "--config", configFile],
          {
            detached: true,
            stdio: ["ignore", log, log],
            cwd: dirname(cli),
          },
        );
        closeSync(log);
        if (!child.pid) throw new Error("Failed to start gateway");
        const identity = fingerprint(child.pid);
        savePrivate(statePath, json({ pid: child.pid, identity }));
        child.unref();
        await sleep(500);
        for (let n = 0; n < 100; n++) {
          if (!daemonState())
            throw new Error(`Gateway exited; inspect ${configFile}.log`);
          try {
            const r = await fetch(`http://127.0.0.1:${config.port}/healthz`, {
              signal: AbortSignal.timeout(500),
            });
            const data = (await r.json()) as any;
            if (data.service === "chat2pi") {
              console.log(
                `Local gateway ready. Public endpoint: ${config.public_url}/mcp — run status to check tunnel reachability.`,
              );
              return;
            }
          } catch {}
          await sleep(100);
        }
        throw new Error(`Gateway not ready yet; inspect ${configFile}.log`);
      }
    } finally {
      closeSync(lock);
      unlinkSync(lockPath);
    }
  } else {
    console.log(
      `Chat2Pi — one plugin, multiple computers\n\ninit --url https://host --id computer [--workspace path] [--unrestricted] [--cloudflare path]\nadd-device --id computer --workspace /path/on/target [--out file] [--unrestricted]\nstart | stop | restart | status\nrun                 foreground gateway + optional Cloudflare tunnel\nagent --config file foreground device client\n\nAll commands accept --config file (default .local/gateway.json).\nPi versions are not restricted. npm update installs the currently available release.`,
    );
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Operation failed");
  process.exitCode = 1;
});
