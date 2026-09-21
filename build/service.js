import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, statSync, fstatSync, unlinkSync, } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { migrateHome } from "./migration.js";
import { loadAgents } from "./accounts.js";
import { bindingFiles } from "./home-store.js";
import { readPrivate, savePrivate, token, secureEqual } from "./config.js";
const statePath = (home) => join(home, "runtime", "service.json");
function state(home) {
    let s;
    for (let attempt = 0; attempt < 21; attempt++) {
        try {
            s = JSON.parse(readPrivate(statePath(home)));
            break;
        }
        catch (error) {
            // Shutdown removes this file concurrently with status/restart polling.
            if (error.code === "ENOENT")
                return;
            // Windows exposes a delete-pending file as EPERM until the last handle
            // closes. Retry briefly, but never mistake a persistent denial for absence.
            if (process.platform === "win32" &&
                ["EPERM", "EACCES", "EBUSY"].includes(error.code) &&
                attempt < 20) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
                continue;
            }
            throw error;
        }
    }
    if (!s)
        throw Error("Invalid local service state");
    if (!Number.isInteger(s.pid) ||
        s.pid < 2 ||
        !Number.isInteger(s.port) ||
        s.port < 1 ||
        s.port > 65535 ||
        typeof s.token !== "string" ||
        typeof s.id !== "string")
        throw Error("Invalid local service state");
    return s;
}
function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e.code !== "ESRCH";
    }
}
function control(s, stop = false) {
    // Native HTTP avoids Pi's global fetch dispatcher and system proxy settings.
    return new Promise((resolve, reject) => {
        const req = httpRequest({
            hostname: "127.0.0.1",
            port: s.port,
            path: stop ? "/stop" : "/status",
            method: stop ? "POST" : "GET",
            headers: { Authorization: "Bearer " + s.token },
        }, (res) => {
            let body = "";
            res.on("data", (chunk) => {
                body += chunk;
                if (body.length > 65536)
                    req.destroy(Error("Invalid control response"));
            });
            res.on("end", () => {
                try {
                    const result = JSON.parse(body);
                    if (res.statusCode !== 200 || result.id !== s.id)
                        throw Error("Local service identity mismatch");
                    resolve(result);
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        req.setTimeout(2000, () => req.destroy(Error("Local service not responding")));
        req.on("error", reject);
        req.end();
    });
}
function configs(home) {
    const files = bindingFiles(home);
    if (!files.length)
        throw Error("No device bindings found; run chat2pi device-import --bundle file --workspace path");
    const result = files.flatMap((path) => loadAgents(path));
    const ids = new Set();
    for (const c of result) {
        const id = `${c.gateway_url}/${c.account_id}/${c.device.device_id}`;
        if (ids.has(id))
            throw Error("Duplicate device binding");
        ids.add(id);
    }
    return result;
}
export async function serve(home) {
    const list = configs(home);
    console.log("Loading Pi tools…");
    const { startAgent } = await import("./agent.js");
    console.log("Pi tools loaded; connecting devices…");
    const agents = [];
    let stopping = false;
    const id = randomUUID(), credential = token();
    const clean = () => {
        try {
            if (state(home)?.id === id)
                unlinkSync(statePath(home));
        }
        catch { }
    };
    const stop = () => {
        if (stopping)
            return;
        stopping = true;
        agents.forEach((a) => a.close());
        clean();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2000).unref();
    };
    const server = createServer((req, res) => {
        if (req.headers.origin ||
            !secureEqual(req.headers.authorization ?? "", "Bearer " + credential)) {
            res.writeHead(403).end();
            return;
        }
        const isStop = req.method === "POST" && req.url === "/stop";
        if (!isStop && !(req.method === "GET" && req.url === "/status")) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({
            id,
            bindings: list.map((c) => ({
                account_id: c.account_id,
                device_id: c.device.device_id,
                server_url: c.gateway_url,
            })),
        }));
        if (isStop)
            res.once("finish", stop);
    });
    try {
        for (const config of list)
            agents.push(startAgent(config));
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        savePrivate(statePath(home), JSON.stringify({
            id,
            token: credential,
            pid: process.pid,
            port: server.address().port,
        }));
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
        process.on("exit", clean);
        console.log(`Chat2Pi running with ${list.length} binding(s)`);
    }
    catch (e) {
        agents.forEach((a) => a.close());
        server.close();
        throw e;
    }
}
async function backgroundCommand(command, home, session) {
    if (command === "serve") {
        await serve(home);
        return true;
    }
    if (!["start", "stop", "restart", "status"].includes(command))
        return false;
    if (command === "status") {
        const s = state(home);
        let current;
        if (s) {
            try {
                current = await control(s);
            }
            catch {
                if (alive(s.pid))
                    throw Error("Service process exists but control is unavailable; inspect runtime/service.log");
            }
        }
        console.log(JSON.stringify({
            home,
            running: !!current,
            configured_bindings: bindingFiles(home).length,
            active_bindings: current?.bindings ?? [],
            log: join(home, "runtime", "service.log"),
        }, null, 2));
        return true;
    }
    const runtime = join(home, "runtime");
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const lockPath = join(runtime, "service.lock");
    if (existsSync(lockPath)) {
        const owner = Number(readFileSync(lockPath, "utf8"));
        if (!Number.isSafeInteger(owner) || owner < 2 || alive(owner))
            throw Error("Another service operation is running");
        unlinkSync(lockPath);
    }
    const lock = openSync(lockPath, "wx", 0o600);
    const { writeSync } = await import("node:fs");
    writeSync(lock, String(process.pid));
    try {
        const pendingPath = join(runtime, "starting.json");
        if (existsSync(pendingPath)) {
            const pending = JSON.parse(readPrivate(pendingPath));
            if (Number.isSafeInteger(pending.pid) &&
                alive(pending.pid) &&
                !state(home))
                throw Error("Service is still starting; inspect runtime/service.log before retrying");
            unlinkSync(pendingPath);
        }
        let s = state(home);
        if (s) {
            try {
                await control(s);
            }
            catch {
                if (alive(s.pid))
                    throw Error("Service process exists but control is unavailable; refusing to start a duplicate");
                unlinkSync(statePath(home));
                s = undefined;
            }
        }
        if ((command === "stop" || command === "restart") && s) {
            await control(s, true);
            for (let i = 0; i < 100 && state(home)?.id === s.id; i++)
                await sleep(100);
            if (state(home)?.id === s.id)
                throw Error("Service is still stopping");
            s = undefined;
        }
        if (command === "stop") {
            console.log("Chat2Pi stopped");
            return true;
        }
        if (s) {
            if (session)
                throw Error("Chat2Pi is already running; use stop before starting a foreground session");
            console.log("Chat2Pi already running; use restart to reload bindings");
            return true;
        }
        migrateHome(home);
        configs(home);
        session?.signal.throwIfAborted();
        console.log("Starting Chat2Pi; loading device tools…");
        const log = openSync(join(runtime, "service.log"), "a", 0o600);
        const child = spawn(process.execPath, [
            fileURLToPath(new URL("./cli.js", import.meta.url)),
            "serve",
            "--home",
            home,
        ], { detached: true, stdio: ["ignore", log, log], windowsHide: true });
        closeSync(log);
        let failure;
        child.on("error", (e) => {
            failure = e;
        });
        if (child.pid)
            savePrivate(pendingPath, JSON.stringify({ pid: child.pid }));
        session?.spawned(child);
        child.unref();
        for (let i = 0; i < 300; i++) {
            session?.signal.throwIfAborted();
            if (failure)
                throw failure;
            const started = state(home);
            if (started && started.pid === child.pid) {
                await control(started);
                if (existsSync(pendingPath))
                    unlinkSync(pendingPath);
                console.log("Chat2Pi started; use status for local state and list_devices for online state");
                return true;
            }
            if (child.exitCode !== null)
                throw Error("Service exited; inspect runtime/service.log");
            await sleep(100);
        }
        throw Error("Service is still starting; inspect status before retrying");
    }
    finally {
        closeSync(lock);
        unlinkSync(lockPath);
    }
}
// Poll a file rather than inheriting child pipes: Windows launchers must not keep
// a hidden service's output handles attached to the interactive terminal.
export async function serviceCommand(command, home, background = false) {
    if (!["start", "restart"].includes(command) || background)
        return backgroundCommand(command, home);
    const abort = new AbortController();
    let child;
    let offset = 0;
    const logPath = join(home, "runtime", "service.log");
    if (existsSync(logPath))
        offset = statSync(logPath).size;
    const { StringDecoder } = await import("node:string_decoder");
    const decoder = new StringDecoder("utf8");
    const poll = () => {
        if (!existsSync(logPath))
            return;
        const fd = openSync(logPath, "r");
        try {
            const size = fstatSync(fd).size;
            if (size < offset)
                offset = 0;
            const buffer = Buffer.alloc(Math.min(size - offset, 65536));
            const count = readSync(fd, buffer, 0, buffer.length, offset);
            offset += count;
            if (count)
                process.stdout.write(decoder.write(buffer.subarray(0, count)));
        }
        finally {
            closeSync(fd);
        }
    };
    const stop = () => abort.abort();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    const timer = setInterval(poll, 200);
    console.log("Foreground session — Ctrl+C stops the service and disconnects devices.");
    try {
        await backgroundCommand(command, home, {
            signal: abort.signal,
            spawned: (value) => {
                child = value;
            },
        });
        while (!abort.signal.aborted) {
            const current = state(home);
            if (!current || current.pid !== child?.pid)
                break;
            if (child?.exitCode !== null || child?.signalCode !== null)
                throw Error("Service exited unexpectedly; see the log above");
            await sleep(200);
        }
    }
    catch (error) {
        if (!abort.signal.aborted)
            throw error;
    }
    finally {
        clearInterval(timer);
        try {
            if (child) {
                const current = state(home);
                if (current && current.pid === child.pid) {
                    await control(current, true).catch(() => { });
                    for (let n = 0; n < 50 && child.exitCode === null && child.signalCode === null; n++)
                        await sleep(100);
                }
                // Also cancel a service still loading Pi, before its control port exists.
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill();
                    for (let n = 0; n < 30 && child.exitCode === null && child.signalCode === null; n++)
                        await sleep(100);
                    if (child.exitCode === null && child.signalCode === null)
                        throw Error("Service has not stopped; inspect status before restarting");
                }
                if (current &&
                    state(home)?.id === current.id &&
                    current.pid === child.pid)
                    unlinkSync(statePath(home));
                const pendingPath = join(home, "runtime", "starting.json");
                if (existsSync(pendingPath) &&
                    JSON.parse(readPrivate(pendingPath)).pid === child.pid)
                    unlinkSync(pendingPath);
            }
            poll();
            process.stdout.write(decoder.end());
        }
        finally {
            process.removeListener("SIGINT", stop);
            process.removeListener("SIGTERM", stop);
        }
    }
    console.log("Chat2Pi stopped");
    return true;
}
