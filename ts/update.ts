import { readFileSync } from "node:fs";
import { preview } from "./log.js";

const manifestUrl =
  "https://raw.githubusercontent.com/kumoSleeping/Chat2Pi/main/package.json";
const installUrl =
  "https://github.com/kumoSleeping/Chat2Pi/archive/refs/heads/main.tar.gz";

// The documented installation channel uses stable versions from main, not npm.
function stableVersion(value: unknown): number[] {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value))
    throw Error("版本信息格式无效");
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error("版本信息格式无效");
  return parts;
}

export async function checkForUpdates(signal: AbortSignal): Promise<void> {
  const timeout = AbortSignal.timeout(3000);
  try {
    const local = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const current = stableVersion(local.version);
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.any([signal, timeout]),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error(`HTTP ${response.status}`);
    }
    if (!response.body) throw Error("版本信息为空");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32 * 1024) {
          await reader.cancel();
          throw Error("版本信息过大");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const remote = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (remote.name !== "chat2pi") throw Error("版本信息来源不匹配");
    const latest = stableVersion(remote.version);
    const changed = latest.findIndex((part, i) => part !== current[i]);
    if (signal.aborted) return;
    if (changed >= 0 && latest[changed] > current[changed]) {
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      console.log(
        `Chat2Pi 有新版本：${local.version} → ${remote.version}（仅提示，不自动安装）\n先停止服务，再运行：${npm} install -g ${installUrl}`,
      );
    } else {
      console.log(`Chat2Pi ${local.version}：未发现更新`);
    }
  } catch (error) {
    if (signal.aborted) return;
    const reason = timeout.aborted
      ? "超过 3 秒"
      : preview(error instanceof Error ? error.message : "网络不可用", 160);
    console.warn(`更新检查未完成（${reason}）；不影响设备启动`);
  }
}
