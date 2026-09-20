import * as sdk from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { readFileSync, realpathSync, existsSync, lstatSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { Ajv } from "ajv";
import { toolNames, type Device } from "./config.js";

let packageDir = dirname(
  fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
);
while (!existsSync(join(packageDir, "package.json")))
  packageDir = dirname(packageDir);
export const piVersion = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf8"),
).version as string;
const factories = {
  read: sdk.createReadTool,
  write: sdk.createWriteTool,
  edit: sdk.createEditTool,
  ls: sdk.createLsTool,
  find: sdk.createFindTool,
  grep: sdk.createGrepTool,
  bash: sdk.createBashTool,
};
export function makeTools(workspace: string, shellPath?: string) {
  const result = new Map<string, any>();
  for (const name of toolNames) {
    if (typeof factories[name] !== "function")
      throw new Error(`Pi ${piVersion} incompatible: missing ${name} factory`);
    const tool =
      name === "bash" && shellPath
        ? sdk.createBashTool(workspace, { shellPath })
        : factories[name](workspace);
    if (
      typeof tool.execute !== "function" ||
      !tool.parameters ||
      tool.parameters.type !== "object"
    )
      throw new Error(
        `Pi ${piVersion} incompatible: invalid ${name} interface`,
      );
    result.set(name, tool);
  }
  return result;
}
export function catalog(workspace: string) {
  return [...makeTools(workspace)].map(([name, t]) => ({
    name,
    description: t.description,
    inputSchema: t.parameters,
  }));
}
// Resolve even a not-yet-created destination through its nearest existing parent.
export function checkPath(workspace: string, value: string): string {
  const root = realpathSync(workspace);
  value = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (value.startsWith("@")) value = value.slice(1);
  if (value === "~") value = homedir();
  else if (value.startsWith("~/") || value.startsWith("~\\"))
    value = join(homedir(), value.slice(2));
  if (value.startsWith("file://")) value = fileURLToPath(value);
  const target = resolve(root, value);
  let parent = target;
  const suffix: string[] = [];
  const exists = (path: string) => {
    try {
      lstatSync(path);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw e;
    }
  };
  while (!exists(parent)) {
    if (dirname(parent) === parent) throw new Error("Invalid path");
    suffix.unshift(parent.slice(dirname(parent).length + 1));
    parent = dirname(parent);
  }
  const resolved = resolve(realpathSync(parent), ...suffix);
  const rel = relative(root, resolved);
  if (
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\") ||
    isAbsolute(rel)
  )
    throw new Error("Path is outside the allowed workspace");
  return resolved;
}
export function executor(device: Device) {
  const tools = makeTools(realpathSync(device.workspace), device.shell_path);
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validators = new Map(
    [...tools].map(([name, t]) => [name, ajv.compile(t.parameters)]),
  );
  return async (
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => {
    if (!device.tools.includes(name as any))
      throw new Error("Tool not allowed on this device");
    const tool = tools.get(name),
      validate = validators.get(name);
    if (!tool || !validate || !validate(args))
      throw new Error("Invalid tool arguments");
    if (device.access === "workspace") {
      if (name === "bash") throw new Error("Shell execution is disabled");
      const path = checkPath(
        device.workspace,
        typeof args.path === "string" ? args.path : ".",
      );
      // Use the checked absolute spelling; do not let Pi reinterpret ~, @ or file:.
      if (name !== "write" && !existsSync(path))
        throw new Error("Path does not exist");
      args = { ...args, path };
    }
    const result = await tool.execute(
      crypto.randomUUID(),
      args,
      signal,
      () => {},
    );
    return { content: result.content, isError: !!result.isError };
  };
}
