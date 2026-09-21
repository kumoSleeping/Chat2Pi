#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { homeDirectory } from "./home-store.js";
import { serviceCommand } from "./service.js";
import { accountCommand } from "./accounts.js";
import { openDeviceFolder } from "./device-folder.js";
import { checkForUpdates } from "./update.js";
async function main() {
    const removed = [
        "device-import",
        "login-import",
        "agent",
        "agent-start",
        "agent-stop",
        "agent-restart",
        "agent-status",
        "init",
        "add-device",
        "run",
        "gateway-start",
        "gateway-stop",
        "gateway-restart",
        "gateway-status",
        "config-check",
        "claim",
        "call",
        "serve",
    ];
    if (removed.includes(process.argv[2]))
        throw Error("This command has been removed. Run chat2pi folder, drop your device JSON into the folder, then run chat2pi start.");
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "v" },
            home: { type: "string" },
            background: { type: "boolean", default: false },
            "no-update-check": { type: "boolean", default: false },
            url: { type: "string" },
            account: { type: "string" },
            credentials: { type: "string" },
            id: { type: "string" },
            name: { type: "string" },
            out: { type: "string" },
            access: { type: "string" },
            tools: { type: "string" },
            action: { type: "string" },
            target: { type: "string" },
            role: { type: "string" },
            confirmation: { type: "string" },
            "key-file": { type: "string" },
        },
    });
    if (values.version) {
        console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
        return;
    }
    const command = values.help ? "help" : (positionals[0] ?? "help");
    const home = homeDirectory(values.home);
    if (command === "help") {
        console.log(`Chat2Pi — drop a device file, then start

folder                 Open the device folder
start                  Show live logs; Ctrl+C stops and disconnects
stop                   Stop the running service
restart                Reload device files and show live logs
status                 Show local service status

Optional: start / restart --background; --home PATH; --version
Startup checks GitHub for updates (notification only).
Skip with --no-update-check or CHAT2PI_NO_UPDATE_CHECK=1.
Device computers need only their device JSON, no account credentials.

Management (only on your management computer):
device-create <name>    Create a device file using your saved account
manage --action ...    Manage accounts and devices
bootstrap --url URL --account NAME --key-file FILE

Account credentials stay in ~/.chat2pi/accounts/ or use --credentials FILE.
Device creation supports --account, --access read|workspace|full and --out.`);
        return;
    }
    if (values.background && !["start", "restart"].includes(command))
        throw Error("--background is only supported by start and restart");
    if (command === "folder") {
        await openDeviceFolder(home);
        return;
    }
    if (["start", "stop", "restart", "status", "_serve"].includes(command)) {
        if (values.account || values.url || values.credentials)
            throw Error("Device service commands use the device folder; account credentials are not required");
        const updateController = new AbortController();
        const update = ["start", "restart"].includes(command) &&
            !values["no-update-check"] &&
            process.env.CHAT2PI_NO_UPDATE_CHECK !== "1"
            ? checkForUpdates(updateController.signal)
            : Promise.resolve();
        try {
            // Check in parallel: GitHub availability must never gate device startup.
            await serviceCommand(command, home, values.background);
            await update;
        }
        finally {
            updateController.abort();
            await update;
        }
        return;
    }
    if (await accountCommand(command, {
        ...values,
        id: values.id ?? (command === "device-create" ? positionals[1] : undefined),
    }))
        return;
    throw Error(`Unknown command: ${command}. Run chat2pi --help.`);
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Operation failed");
    process.exitCode = 1;
});
