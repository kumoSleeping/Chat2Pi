import type { Express, Response } from "express";
import express from "express";
import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidRequestError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { readPrivate, savePrivate, secureEqual, token } from "./config.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
type Grant = { clientId: string; expires: number };
type Stored = {
  clients: Record<string, OAuthClientInformationFull>;
  access: Record<string, Grant>;
  refresh: Record<string, Grant>;
};
type Pending = {
  clientId: string;
  params: AuthorizationParams;
  expires: number;
  csrf: string;
};
export class PersonalAuth implements OAuthServerProvider {
  private state: Stored;
  private requests = new Map<string, Pending>();
  private codes = new Map<string, Pending>();
  private ownerKey: string;
  constructor(
    readonly origin: string,
    readonly stateFile: string,
    ownerKeyFile: string,
  ) {
    this.ownerKey = readPrivate(ownerKeyFile);
    if (this.ownerKey.length < 32)
      throw new Error("Owner key must be at least 32 characters");
    this.state = existsSync(stateFile)
      ? JSON.parse(readPrivate(stateFile))
      : { clients: {}, access: {}, refresh: {} };
  }
  private persist() {
    const now = Date.now();
    for (const grants of [this.state.access, this.state.refresh])
      for (const [key, grant] of Object.entries(grants))
        if (grant.expires <= now) delete grants[key];
    savePrivate(this.stateFile + ".tmp", JSON.stringify(this.state));
    renameSync(this.stateFile + ".tmp", this.stateFile);
  }
  readonly clientsStore = {
    getClient: (id: string) =>
      Object.hasOwn(this.state.clients, id)
        ? this.state.clients[id]
        : undefined,
    registerClient: (
      client: Omit<
        OAuthClientInformationFull,
        "client_id" | "client_id_issued_at"
      >,
    ) => {
      if (Object.keys(this.state.clients).length >= 64)
        throw new InvalidRequestError("Client registration limit reached");
      for (const uri of client.redirect_uris) {
        const u = new URL(uri);
        if (u.protocol !== "https:" || u.username || u.password || u.hash)
          throw new InvalidRequestError("HTTPS redirect required");
      }
      const registered = {
        ...client,
        client_id: token(),
        client_id_issued_at: Math.floor(Date.now() / 1000),
      };
      this.state.clients[registered.client_id] = registered;
      this.persist();
      return registered;
    },
  };
  private checkResource(resource?: URL) {
    if (resource && resource.href !== new URL("/mcp", this.origin).href)
      throw new InvalidRequestError("Wrong resource");
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    this.checkResource(params.resource);
    if (params.scopes?.some((s) => s !== "pi:tools"))
      throw new InvalidRequestError("Unsupported scope");
    for (const [id, r] of this.requests)
      if (r.expires < Date.now()) this.requests.delete(id);
    if (this.requests.size >= 128)
      throw new InvalidRequestError("Too many pending authorizations");
    const id = token(),
      csrf = token();
    this.requests.set(id, {
      clientId: client.client_id,
      params,
      expires: Date.now() + 300_000,
      csrf,
    });
    res.cookie("pi_consent", csrf, {
      httpOnly: true,
      secure: this.origin.startsWith("https:"),
      sameSite: "lax",
      maxAge: 300_000,
      path: "/approve",
    });
    res
      .type("html")
      .send(
        `<!doctype html><html lang="zh"><meta charset="utf-8"><title>Pi Tools 授权</title><body><h1>连接你的 Pi Tools</h1><p>此连接可调用你配置的电脑工具，包括已启用的写入和命令执行。</p><p>客户端：${escape(client.client_name || client.client_id)}</p><p>返回地址：${escape(params.redirectUri)}</p><form method="post" action="/approve"><input type="hidden" name="request" value="${id}"><label>输入本机生成的个人授权密钥：<input type="password" name="owner_key" required autocomplete="off"></label><button>授权连接</button></form></body></html>`,
      );
  }
  mount(app: Express) {
    app.use(
      mcpAuthRouter({
        provider: this,
        issuerUrl: new URL(this.origin),
        resourceServerUrl: new URL("/mcp", this.origin),
        scopesSupported: ["pi:tools"],
      }),
    );
    // A bounded single-owner throttle; no attacker-controlled IP map to grow.
    let windowStart = 0,
      attempts = 0;
    app.post(
      "/approve",
      express.urlencoded({ extended: false, limit: "4kb" }),
      (req, res) => {
        if (Date.now() - windowStart > 60_000) {
          windowStart = Date.now();
          attempts = 0;
        }
        if (++attempts > 20) {
          res.sendStatus(429);
          return;
        }
        const id = typeof req.body.request === "string" ? req.body.request : "";
        const r = this.requests.get(id);
        const cookie =
          (req.headers.cookie || "")
            .split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("pi_consent="))
            ?.slice(11) || "";
        if (
          !r ||
          r.expires < Date.now() ||
          req.headers.origin !== this.origin ||
          !secureEqual(cookie, r.csrf)
        ) {
          res.sendStatus(403);
          return;
        }
        if (
          typeof req.body.owner_key !== "string" ||
          !secureEqual(req.body.owner_key, this.ownerKey)
        ) {
          res.sendStatus(403);
          return;
        }
        this.requests.delete(id);
        for (const [key, code] of this.codes)
          if (code.expires < Date.now()) this.codes.delete(key);
        const code = token();
        this.codes.set(hash(code), { ...r, expires: Date.now() + 60_000 });
        const url = new URL(r.params.redirectUri);
        url.searchParams.set("code", code);
        if (r.params.state) url.searchParams.set("state", r.params.state);
        res.clearCookie("pi_consent", { path: "/approve" });
        res.redirect(url.href);
      },
    );
  }
  private code(clientId: string, code: string) {
    const r = this.codes.get(hash(code));
    if (!r || r.expires < Date.now() || r.clientId !== clientId)
      throw new InvalidGrantError("Invalid or expired code");
    return r;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    return this.code(client.client_id, code).params.codeChallenge;
  }
  private issue(clientId: string): OAuthTokens {
    const access = token(),
      refresh = token();
    this.state.access[hash(access)] = {
      clientId,
      expires: Date.now() + 3600_000,
    };
    this.state.refresh[hash(refresh)] = {
      clientId,
      expires: Date.now() + 30 * 86400_000,
    };
    this.persist();
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "pi:tools",
    };
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    this.checkResource(resource);
    const r = this.code(client.client_id, code);
    if (redirectUri !== r.params.redirectUri)
      throw new InvalidGrantError("Redirect mismatch");
    this.codes.delete(hash(code));
    return this.issue(client.client_id);
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refresh: string,
    scopes?: string[],
    resource?: URL,
  ) {
    this.checkResource(resource);
    if (scopes?.some((s) => s !== "pi:tools"))
      throw new InvalidGrantError("Invalid scope");
    const r = this.state.refresh[hash(refresh)];
    if (!r || r.clientId !== client.client_id || r.expires < Date.now())
      throw new InvalidGrantError("Invalid refresh token");
    delete this.state.refresh[hash(refresh)];
    return this.issue(client.client_id);
  }
  async verifyAccessToken(value: string) {
    const r = this.state.access[hash(value)];
    if (!r || r.expires < Date.now())
      throw new InvalidTokenError("Invalid access token");
    return {
      token: value,
      clientId: r.clientId,
      scopes: ["pi:tools"],
      expiresAt: Math.floor(r.expires / 1000),
      resource: new URL("/mcp", this.origin),
    };
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: { token: string },
  ) {
    for (const grants of [this.state.access, this.state.refresh]) {
      const key = hash(request.token);
      if (grants[key]?.clientId === client.client_id) delete grants[key];
    }
    this.persist();
  }
}
