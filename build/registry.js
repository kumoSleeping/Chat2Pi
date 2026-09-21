import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { Runner } from "./runner.js";
export class Registry {
    config;
    remotes = new Map();
    pending = new Map();
    local;
    constructor(config) {
        this.config = config;
        if (config.local_device)
            this.local = new Runner(config.local_device);
    }
    attach(id, remote) {
        if (this.remotes.has(id) || this.local?.device.device_id === id)
            throw new Error("Device already online");
        this.remotes.set(id, remote);
    }
    detach(id, socket) {
        if (this.remotes.get(id)?.socket !== socket)
            return;
        this.remotes.delete(id);
        for (const [key, p] of this.pending)
            if (p.deviceId === id) {
                p.cleanup();
                this.pending.delete(key);
                p.reject(new Error("Device disconnected; execution outcome may be unknown. Do not retry automatically."));
            }
    }
    result(id, requestId, result, error) {
        const p = this.pending.get(requestId);
        if (!p || p.deviceId !== id)
            return;
        p.cleanup();
        this.pending.delete(requestId);
        error ? p.reject(new Error(error)) : p.resolve(result);
    }
    list() {
        const devices = this.config.devices.map((d) => {
            const r = this.remotes.get(d.device_id);
            return {
                device_id: d.device_id,
                status: r ? "online" : "offline",
                tools: r?.tools ?? d.tools,
                platform: r?.platform,
                pi_version: r?.piVersion,
            };
        });
        if (this.local)
            devices.unshift({
                device_id: this.local.device.device_id,
                status: "online",
                tools: this.local.device.tools,
                platform: process.platform,
                pi_version: undefined,
            });
        return {
            online_count: devices.filter((d) => d.status === "online").length,
            devices,
        };
    }
    async call(id, name, args, signal) {
        signal?.throwIfAborted();
        if (this.local?.device.device_id === id)
            return this.local.call(id, name, args, { signal });
        const r = this.remotes.get(id);
        if (!r || r.socket.readyState !== WebSocket.OPEN)
            throw new Error("Target device is offline or unknown; call list_devices");
        if (!r.tools.includes(name))
            throw new Error("Tool not allowed on target device");
        const requestId = randomUUID();
        return await new Promise((resolve, reject) => {
            const cancel = (message) => {
                const p = this.pending.get(requestId);
                if (!p)
                    return;
                p.cleanup();
                this.pending.delete(requestId);
                reject(new Error(message));
                r.socket.send(JSON.stringify({ type: "cancel", request_id: requestId }), (error) => {
                    if (error)
                        this.detach(id, r.socket);
                });
            };
            const onAbort = () => cancel("Operation cancelled; execution outcome may be unknown. Do not retry automatically.");
            const timer = setTimeout(() => cancel("Device response timed out; outcome unknown. Do not retry automatically."), 310_000);
            const cleanup = () => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
            };
            this.pending.set(requestId, { deviceId: id, resolve, reject, cleanup });
            signal?.addEventListener("abort", onAbort, { once: true });
            r.socket.send(JSON.stringify({
                type: "call",
                request_id: requestId,
                device_id: id,
                name,
                arguments: args,
            }), (error) => {
                if (error)
                    this.detach(id, r.socket);
            });
        });
    }
    close() {
        this.local?.close();
        for (const [id, r] of this.remotes) {
            this.detach(id, r.socket);
            r.socket.terminate();
        }
    }
}
