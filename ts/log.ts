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
type Level = "INFO" | "START" | "OK" | "WARN" | "ERROR";
export function log(level: Level, message: string) {
  const line = `${new Date().toISOString()} [${level}] ${preview(message, 1800)}`;
  if (level === "ERROR") console.error(line);
  else console.log(line);
}
export function colorizeLog(line: string): string {
  if (
    !process.stdout.isTTY ||
    process.env.NO_COLOR !== undefined ||
    process.env.TERM === "dumb"
  )
    return line;
  const colors: Record<Level, number> = {
    INFO: 36,
    START: 34,
    OK: 32,
    WARN: 33,
    ERROR: 31,
  };
  return line.replace(
    /^(\S+) \[(INFO|START|OK|WARN|ERROR)\](.*)$/,
    (_, time, level: Level, body) =>
      `\x1b[90m${time}\x1b[0m \x1b[1;${colors[level]}m[${level}]\x1b[0m${body}`,
  );
}
