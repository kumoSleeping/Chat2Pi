import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { bindingFiles } from "./home-store.js";
import { prepareDeviceBundle } from "./accounts.js";
import { savePrivate } from "./config.js";

// Downloaded files normally have mode 0644 on macOS. Validate them first, then
// restrict permissions and fill local settings in place; no import command.
export function prepareDeviceFolder(home: string) {
  const dir = join(home, "devices");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const inputs = bindingFiles(home).filter(
    (path) => path.startsWith(dir + "/") || path.startsWith(dir + "\\"),
  );
  const prepared = inputs.map((path) => {
    const text = readFileSync(path, "utf8");
    const raw = JSON.parse(text);
    if (raw.login_key)
      throw Error(
        `Account credentials belong outside the devices folder: ${path}`,
      );
    return { path, text, raw, value: prepareDeviceBundle(raw) };
  });
  const selected = new Map<string, (typeof prepared)[number]>();
  const duplicates: typeof prepared = [];
  for (const entry of prepared) {
    const b = entry.value.binding;
    const id = `${b.server_url}/${b.account_id}/${b.device_id}`;
    const previous = selected.get(id);
    if (!previous) {
      selected.set(id, entry);
      continue;
    }
    if (
      !isDeepStrictEqual(previous.value.binding, b) ||
      previous.value.device_key !== entry.value.device_key
    )
      throw Error(
        `Conflicting device files; originals preserved: ${previous.path}, ${entry.path}`,
      );
    // Copying an already-installed download again must not reset local settings.
    if (previous.raw.local && !entry.raw.local) {
      duplicates.push(entry);
      continue;
    }
    if (!previous.raw.local && entry.raw.local) {
      duplicates.push(previous);
      selected.set(id, entry);
      continue;
    }
    if (!isDeepStrictEqual(previous.value, entry.value))
      throw Error(
        `Conflicting local device settings; originals preserved: ${previous.path}, ${entry.path}`,
      );
    duplicates.push(entry);
  }
  for (const entry of prepared)
    if (readFileSync(entry.path, "utf8") !== entry.text)
      throw Error("Device configuration changed while loading; retry start");
  for (const entry of selected.values()) {
    mkdirSync(entry.value.local.workspace, { recursive: true });
    if (process.platform !== "win32") chmodSync(entry.path, 0o600);
    if (
      !isDeepStrictEqual(JSON.parse(JSON.stringify(entry.value)), entry.raw)
    ) {
      savePrivate(entry.path, JSON.stringify(entry.value, null, 2) + "\n");
      console.log(`Device configured: ${entry.value.binding.device_id}`);
    }
  }
  for (const entry of duplicates) {
    if (readFileSync(entry.path, "utf8") !== entry.text)
      throw Error("Duplicate device file changed; original retained");
    unlinkSync(entry.path);
  }
}

export async function openDeviceFolder(home: string) {
  const path = join(home, "devices");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [path], {
      detached: true,
      stdio: "ignore",
      // This is a user-requested GUI window, not a background tool worker.
      windowsHide: false,
    });
    child.once("error", () =>
      reject(
        Error(
          `Could not open the file manager. Open this folder manually: ${path}`,
        ),
      ),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  console.log(
    `Device folder: ${path}\nDrop your downloaded device JSON here, then run chat2pi start. If already running, press Ctrl+C first.`,
  );
}
