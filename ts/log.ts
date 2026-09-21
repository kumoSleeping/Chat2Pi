import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

// Keep the on-disk log plain, bounded and safe to render in a terminal.
const secretKey =
  /password|passwd|secret|token|authorization|cookie|api[-_]?key|device[-_]?key|login[-_]?key/i;
export function preview(value: unknown, limit = 180): string {
  const text = String(value)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(
      /((?:password|passwd|secret|token|api[-_]?key|device[-_]?key|login[-_]?key)["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}
function valuePreview(value: unknown, depth = 0): string {
  if (typeof value === "string") return JSON.stringify(preview(value));
  if (value === null || typeof value !== "object") return preview(value);
  if (depth >= 2) return Array.isArray(value) ? "[…]" : "{…}";
  if (Array.isArray(value))
    return (
      "[" +
      value
        .slice(0, 3)
        .map((v) => valuePreview(v, depth + 1))
        .join(", ") +
      (value.length > 3 ? ", …" : "") +
      "]"
    );
  const entries = Object.entries(value);
  return (
    "{" +
    entries
      .slice(0, 6)
      .map(
        ([key, v]) =>
          `${preview(key, 40)}: ${secretKey.test(key) ? '"[redacted]"' : valuePreview(v, depth + 1)}`,
      )
      .join(", ") +
    (entries.length > 6 ? ", …" : "") +
    "}"
  );
}
export function argumentPreview(args: Record<string, unknown>): string {
  // Show paths and commands before potentially large write/edit contents.
  const priority = ["path", "command", "pattern", "offset", "limit", "timeout"];
  const entries = Object.entries(args).sort(([a], [b]) => {
    const rank = (key: string) => {
      const index = priority.indexOf(key);
      return index < 0 ? priority.length : index;
    };
    return rank(a) - rank(b);
  });
  return preview(
    entries
      .slice(0, 8)
      .map(
        ([key, value]) =>
          `${preview(key, 40)}=${secretKey.test(key) ? '"[redacted]"' : valuePreview(value)}`,
      )
      .join(" ") + (entries.length > 8 ? " …" : ""),
    1000,
  );
}
function shortPath(value: string, workspace: string): string {
  if (!isAbsolute(value)) return value;
  const local = relative(workspace, value);
  if (!local) return ".";
  if (!isAbsolute(local) && local !== ".." && !local.startsWith(".." + sep))
    return local;
  const home = homedir();
  return value.startsWith(home + sep) ? "~" + value.slice(home.length) : value;
}

export function operationSummary(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
): string {
  let detail: string;
  if (name === "bash") {
    detail = String(args.command ?? "")
      .replaceAll(workspace + sep, "." + sep)
      .replaceAll(homedir() + sep, "~" + sep);
    // Environment assignments are context, not the command the user is watching.
    detail = detail.replace(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)+/,
      "",
    );
  } else {
    detail = shortPath(
      typeof args.path === "string" ? args.path : ".",
      workspace,
    );
    if (typeof args.pattern === "string")
      detail += ` · ${preview(args.pattern, 60)}`;
    if (name === "read" && typeof args.offset === "number")
      detail += `:${args.offset}`;
  }
  return `${preview(name, 24)}  ${preview(detail, 100)}`;
}

// Pi appends command failure/timeout status after captured output.
export function errorSummary(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lastLine =
    text
      .trim()
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .at(-1) ?? "Tool failed";
  return preview(lastLine, 240);
}

type Level = "INFO" | "QUEUE" | "START" | "OK" | "WARN" | "ERROR";
export function log(level: Level, message: string, details?: string) {
  // A tab separates optional diagnostics from the concise human-facing message.
  const line = `${new Date().toISOString()} [${level}] ${preview(message, 600)}${details ? "\t" + preview(details, 1800) : ""}`;
  if (level === "ERROR") console.error(line);
  else console.log(line);
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function fitLine(text: string, columns: number): string {
  let width = 0;
  let result = "";
  for (const { segment } of segmenter.segment(text)) {
    // CJK and emoji generally occupy two terminal cells; combining marks stay
    // attached to their base character so truncation cannot split a glyph.
    const wide =
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(
        segment,
      );
    width += wide ? 2 : 1;
    if (width > columns - 1) return result + "…";
    result += segment;
  }
  return result;
}

export function formatLogLine(line: string): string | undefined {
  const match = /^(\S+) \[(INFO|QUEUE|START|OK|WARN|ERROR)\] (.*)$/.exec(
    line.split("\t", 1)[0],
  );
  if (!match) return line;
  const [, timestamp, level, message] = match;
  if (level === "OK") return;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return line;
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  const marks: Record<string, string> = {
    INFO: "·",
    QUEUE: "…",
    START: "→",
    WARN: "!",
    ERROR: "✗",
  };
  const text = `${time} ${marks[level]} ${message}`;
  // Errors retain their reason even if it needs another terminal line.
  const output =
    level === "ERROR" || level === "WARN"
      ? text
      : fitLine(text, Math.max(20, (process.stdout.columns ?? 100) - 1));
  if (
    !process.stdout.isTTY ||
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === "dumb"
  )
    return output;
  const colors: Record<string, number> = {
    INFO: 36,
    QUEUE: 35,
    START: 34,
    WARN: 33,
    ERROR: 31,
  };
  return `\x1b[90m${output.slice(0, 8)}\x1b[0m \x1b[${colors[level]}m${output.slice(9, 10)}\x1b[0m${output.slice(10)}`;
}
