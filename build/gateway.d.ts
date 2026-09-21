import { PersonalAuth } from "./auth.js";
import { Registry } from "./registry.js";
import { type GatewayConfig } from "./config.js";
export declare function startGateway(config: GatewayConfig): Promise<{
    registry: Registry;
    http: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
    auth: PersonalAuth;
    close: () => Promise<void>;
}>;
