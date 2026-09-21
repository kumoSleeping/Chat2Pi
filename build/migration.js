import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, fsyncSync, unlinkSync, renameSync, } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bindingPath, filesIn, loginPath } from "./home-store.js";
import { bindingSchema } from "./manifest.js";
import { readPrivate, token } from "./config.js";
import { deviceBundleSchema, hash, loadAgents, localCredentialsSchema, loginSchema, } from "./accounts.js";
// Only migrate the managed store. Downloads, archives and arbitrary user paths
// are not disposable configuration and must never be recursively pruned.
export function migrateHome(home) {
    const bindings = filesIn(home, "bindings", ".binding.json");
    const logins = filesIn(home, "accounts", ".login.json");
    const runtime = join(home, "runtime");
    const journalPath = join(runtime, "migration.json");
    if (!bindings.length && !logins.length && !existsSync(journalPath))
        return;
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const lockPath = join(runtime, "migration.lock");
    if (existsSync(lockPath)) {
        const pid = Number(readPrivate(lockPath));
        if (!Number.isSafeInteger(pid) || pid < 2)
            throw Error("Invalid migration lock; originals preserved");
        try {
            process.kill(pid, 0);
            throw Error("Configuration migration is already running");
        }
        catch (error) {
            if (error.code !== "ESRCH")
                throw error;
        }
        unlinkSync(lockPath);
    }
    const lock = openSync(lockPath, "wx", 0o600);
    writeFileSync(lock, String(process.pid));
    const sources = new Map();
    const destinations = new Map();
    const source = (path) => {
        const text = readPrivate(path);
        sources.set(path, text);
        return JSON.parse(text);
    };
    const plan = (path, value, device) => {
        const normalized = JSON.parse(JSON.stringify(value));
        if (destinations.has(path) &&
            !isDeepStrictEqual(destinations.get(path).value, normalized))
            throw Error("Conflicting legacy configurations; originals preserved");
        destinations.set(path, { value: normalized, device });
    };
    const durableWrite = (path, value) => {
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = path + "." + token() + ".tmp";
        const fd = openSync(temporary, "wx", 0o600);
        try {
            writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
        renameSync(temporary, path);
        if (process.platform !== "win32") {
            const dir = openSync(dirname(path), "r");
            try {
                fsyncSync(dir);
            }
            finally {
                closeSync(dir);
            }
        }
    };
    const finishJournal = () => {
        const journal = JSON.parse(readPrivate(journalPath));
        for (const entry of journal.targets) {
            if (hash(readPrivate(entry.path)) !== entry.digest)
                throw Error("Migrated configuration changed; remaining originals preserved");
        }
        for (const entry of journal.sources) {
            if (existsSync(entry.path) &&
                hash(readPrivate(entry.path)) !== entry.digest)
                throw Error("Legacy configuration changed; remaining originals preserved");
        }
        for (const entry of journal.sources)
            if (existsSync(entry.path))
                unlinkSync(entry.path);
        unlinkSync(journalPath);
    };
    try {
        if (existsSync(journalPath)) {
            finishJournal();
            console.log("Completed interrupted configuration migration.");
            return;
        }
        for (const path of logins) {
            const login = loginSchema.parse(source(path));
            plan(loginPath(home, login.server_url, login.account_id), login, false);
        }
        for (const path of bindings) {
            const raw = JSON.parse(readPrivate(path));
            // Legacy standalone agents have no cloud binding to reconstruct safely.
            if (raw.version !== 1)
                continue;
            source(path);
            const { login_key, ...fields } = raw;
            const binding = bindingSchema.parse(fields);
            const credentialsPath = path + ".credentials.json";
            const credentialsRaw = source(credentialsPath);
            const { login_key: sidecarLogin, ...deviceFields } = credentialsRaw;
            const credentials = localCredentialsSchema.parse(deviceFields);
            if (hash(credentials.device_key) !== binding.device_key_sha256)
                throw Error("Legacy device credential mismatch; originals preserved");
            for (const key of [login_key, sidecarLogin]) {
                if (key === undefined)
                    continue;
                const login = loginSchema.parse({
                    server_url: binding.server_url,
                    account_id: binding.account_id,
                    login_key: key,
                });
                plan(loginPath(home, login.server_url, login.account_id), login, false);
            }
            const device = deviceBundleSchema.parse({ binding, ...credentials });
            plan(bindingPath(home, binding.server_url, binding.account_id, binding.device_id), device, true);
        }
        // Check every target before touching any source. Restarting after a partial
        // migration is safe only when the already-written destination is identical.
        for (const [path, { value }] of destinations) {
            if (existsSync(path) &&
                !isDeepStrictEqual(JSON.parse(readPrivate(path)), value))
                throw Error(`Migration target differs; originals preserved: ${path}`);
        }
        for (const [path, { value }] of destinations) {
            if (existsSync(path))
                continue;
            durableWrite(path, value);
        }
        for (const [path, { value, device }] of destinations) {
            if (!isDeepStrictEqual(JSON.parse(readPrivate(path)), value))
                throw Error("Migration verification failed; originals preserved");
            if (device)
                loadAgents(path);
            else
                loginSchema.parse(JSON.parse(readPrivate(path)));
        }
        for (const [path, original] of sources) {
            if (readPrivate(path) !== original)
                throw Error("Legacy configuration changed during migration; originals preserved");
        }
        if (sources.size) {
            durableWrite(journalPath, {
                sources: [...sources].map(([path, text]) => ({
                    path,
                    digest: hash(text),
                })),
                targets: [...destinations.keys()].map((path) => ({
                    path,
                    digest: hash(readPrivate(path)),
                })),
            });
            finishJournal();
        }
        if (sources.size)
            console.log(`Configuration migrated: ${destinations.size} account/device file(s); ${sources.size} replaced legacy file(s) removed.`);
    }
    finally {
        closeSync(lock);
        unlinkSync(lockPath);
    }
}
