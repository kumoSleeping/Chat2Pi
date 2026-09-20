import { fork } from "node:child_process";
import type { Device } from "./config.js";

export class Runner {
  private busy = false;
  private stop?: () => void;
  constructor(readonly device: Device) {}
  close() {
    this.stop?.();
  }
  async call(
    deviceId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<any> {
    if (deviceId !== this.device.device_id)
      throw new Error("Wrong target device");
    if (!this.device.tools.includes(name as any))
      throw new Error("Tool not allowed");
    if (this.busy)
      throw new Error("Device busy; wait for the current operation");
    this.busy = true;
    try {
      return await new Promise((resolve, reject) => {
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
        const finish = (error?: Error, result?: unknown) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.stop = undefined;
          try {
            if (process.platform !== "win32" && child.pid)
              process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {}
          error ? reject(error) : resolve(result);
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "Tool timed out; side effects may have occurred. Do not retry automatically.",
              ),
            ),
          this.device.timeout_seconds * 1000,
        );
        this.stop = () =>
          finish(
            new Error(
              "Device disconnected; operation cancelled. Side effects may have occurred.",
            ),
          );
        child.once("message", (m: any) =>
          finish(m.error ? new Error(m.error) : undefined, m.result),
        );
        child.once("error", finish);
        child.once("exit", () =>
          finish(new Error("Tool worker exited without a result")),
        );
        child.send({ device: this.device, name, args });
      });
    } finally {
      this.busy = false;
    }
  }
}
