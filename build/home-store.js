import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { readPrivate } from "./config.js";
import { identifier } from "./manifest.js";
export const homeDirectory = (override) => resolve(override ?? join(homedir(), ".chat2pi"));
export function serverTag(url) {
    return createHash("sha256")
        .update(new URL(url).origin)
        .digest("hex")
        .slice(0, 16);
}
export function loginPath(home, url, account) {
    return join(home, "accounts", serverTag(url), `link_chatgpt_plugin_oauth_${identifier.parse(account)}.json`);
}
export function bindingPath(home, url, account, device) {
    return join(home, "devices", serverTag(url), identifier.parse(account), `${identifier.parse(device)}.json`);
}
export function filesIn(home, folder, suffix) {
    const dir = join(home, folder);
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((x) => x.isFile() && x.name.endsWith(suffix))
        .map((x) => join(dir, x.name))
        .sort();
}
function jsonTree(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory()
            ? jsonTree(path)
            : entry.isFile() && entry.name.endsWith(".json")
                ? [path]
                : [];
    })
        .sort();
}
export const bindingFiles = (home) => [
    ...filesIn(home, "bindings", ".binding.json"),
    ...jsonTree(join(home, "devices")),
];
export function selectLogin(home, account, url) {
    const files = jsonTree(join(home, "accounts")).filter((path) => {
        const login = JSON.parse(readPrivate(path));
        return ((!account || login.account_id === account) &&
            (!url || new URL(login.server_url).origin === new URL(url).origin));
    });
    if (files.length !== 1)
        throw Error(files.length
            ? "Multiple accounts found; select --account and, if necessary, --url"
            : "No account credential found; use login-import --bundle file or --credentials file");
    return files[0];
}
