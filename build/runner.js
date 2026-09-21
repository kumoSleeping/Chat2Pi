import { fork, execFileSync } from "node:child_process";
import { DEFAULT_MAX_CONCURRENT } from "./config.js";
import { ToolQueue } from "./tool-queue.js";
export class Runner {
    device;
    queue;
    constructor(device) {
        this.device = device;
        this.queue = new ToolQueue(device.max_concurrent ?? DEFAULT_MAX_CONCURRENT);
    }
    close() {
        this.queue.close();
    }
    async call(deviceId, name, args, options = {}) {
        if (deviceId !== this.device.device_id)
            throw new Error("Wrong target device");
        if (!this.device.tools.includes(name))
            throw new Error("Tool not allowed");
        return this.queue.run((signal) => this.execute(name, args, signal), {
            ...options,
            timeoutMs: this.device.timeout_seconds * 1000,
        });
    }
    execute(name, args, signal) {
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const child = fork(new URL("./worker.js", import.meta.url), [], {
                cwd: this.device.workspace,
                detached: process.platform !== "win32",
                stdio: ["ignore", "ignore", "ignore", "ipc"],
                env: {
                    PATH: process.env.PATH,
                    HOME: process.env.HOME,
                    USERPROFILE: process.env.USERPROFILE,
                    SystemRoot: process.env.SystemRoot,
                    ProgramFiles: process.env.ProgramFiles,
                    "ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
                    LOCALAPPDATA: process.env.LOCALAPPDATA,
                    APPDATA: process.env.APPDATA,
                    TEMP: process.env.TEMP,
                    TMP: process.env.TMP,
                    PATHEXT: process.env.PATHEXT,
                    ComSpec: process.env.ComSpec,
                    TMPDIR: process.env.TMPDIR,
                    PI_SKIP_VERSION_CHECK: "1",
                    PI_TELEMETRY: "0",
                },
            });
            let done = false;
            let killTimer;
            const finish = (error, result) => {
                if (done)
                    return;
                done = true;
                clearTimeout(killTimer);
                signal.removeEventListener("abort", abort);
                try {
                    if (process.platform !== "win32" && child.pid)
                        process.kill(-child.pid, "SIGKILL");
                    else if (child.pid &&
                        child.exitCode === null &&
                        child.signalCode === null) {
                        // Terminate the worker and any command it launched on Windows.
                        try {
                            execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
                                stdio: "ignore",
                                windowsHide: true,
                                timeout: 3000,
                            });
                        }
                        catch {
                            child.kill("SIGKILL");
                        }
                    }
                }
                catch { }
                if (signal.aborted)
                    reject(signal.reason);
                else
                    error ? reject(error) : resolve(result);
            };
            const abort = () => {
                // Let Pi stop its shell process group before killing the worker.
                killTimer = setTimeout(() => finish(signal.reason), 2000);
                try {
                    child.send({ type: "cancel" }, (error) => {
                        if (error)
                            finish(signal.reason);
                    });
                }
                catch {
                    finish(signal.reason);
                }
            };
            signal.addEventListener("abort", abort, { once: true });
            child.once("message", (m) => finish(m.error ? new Error(m.error) : undefined, m.result));
            child.once("error", finish);
            child.once("exit", () => finish(new Error("Tool worker exited without a result")));
            try {
                child.send({ device: this.device, name, args }, (error) => {
                    if (error)
                        finish(error);
                });
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error("Worker IPC failed"));
            }
        });
    }
}
