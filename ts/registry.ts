import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type { GatewayConfig } from "./config.js";
import { Runner } from "./runner.js";

type Remote = {
  socket: WebSocket;
  tools: string[];
  platform: string;
  piVersion: string;
};
export class Registry {
  readonly remotes = new Map<string, Remote>();
  private pending = new Map<
    string,
    {
      deviceId: string;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly local?: Runner;
  constructor(readonly config: GatewayConfig) {
    if (config.local_device) this.local = new Runner(config.local_device);
  }
  attach(id: string, remote: Remote) {
    if (this.remotes.has(id) || this.local?.device.device_id === id)
      throw new Error("Device already online");
    this.remotes.set(id, remote);
  }
  detach(id: string, socket: WebSocket) {
    if (this.remotes.get(id)?.socket !== socket) return;
    this.remotes.delete(id);
    for (const [key, p] of this.pending)
      if (p.deviceId === id) {
        clearTimeout(p.timer);
        this.pending.delete(key);
        p.reject(
          new Error(
            "Device disconnected; execution outcome may be unknown. Do not retry automatically.",
          ),
        );
      }
  }
  result(id: string, requestId: string, result: unknown, error?: string) {
    const p = this.pending.get(requestId);
    if (!p || p.deviceId !== id) return;
    clearTimeout(p.timer);
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
  async call(id: string, name: string, args: Record<string, unknown>) {
    if (this.local?.device.device_id === id)
      return this.local.call(id, name, args);
    const r = this.remotes.get(id);
    if (!r || r.socket.readyState !== WebSocket.OPEN)
      throw new Error("Target device is offline or unknown; call list_devices");
    if (!r.tools.includes(name))
      throw new Error("Tool not allowed on target device");
    if ([...this.pending.values()].some((p) => p.deviceId === id))
      throw new Error("Target device busy");
    const requestId = randomUUID();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        r.socket.close(1011, "Operation timeout");
        reject(
          new Error(
            "Device response timed out; outcome unknown. Do not retry automatically.",
          ),
        );
      }, 310_000);
      this.pending.set(requestId, { deviceId: id, resolve, reject, timer });
      r.socket.send(
        JSON.stringify({
          type: "call",
          request_id: requestId,
          device_id: id,
          name,
          arguments: args,
        }),
        (error) => {
          if (error) this.detach(id, r.socket);
        },
      );
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
