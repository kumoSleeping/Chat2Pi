import { DurableObject } from "cloudflare:workers";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import {
  bindingSchema,
  identifier,
  manageSchema,
  type Binding,
  type Manage,
} from "../ts/manifest";
import { digest, secret } from "./crypto";
export type Account = {
  account_id: string;
  name: string;
  role: "admin" | "member";
  enabled: boolean;
  login_hash: string;
  generation: string;
};
export type Identity = { accountId: string; generation: string };
export interface DirectoryEnv {
  PUBLIC_URL: string;
  BOOTSTRAP_KEY_SHA256: string;
}
interface State {
  initialized: boolean;
  accounts: Record<string, Account>;
  bindings: Record<string, Binding>;
  tickets: Record<
    string,
    {
      expires: number;
      value: unknown;
      account: string;
      generation: string;
      bindingHash?: string;
      device?: string;
    }
  >;
  intents: Record<
    string,
    {
      expires: number;
      actor: string;
      generation: string;
      request: string;
      targetGeneration: string;
      bindingHash?: string;
    }
  >;
  consents: Record<
    string,
    { expires: number; csrf: string; auth: AuthRequest }
  >;
}
const fresh = (): State => ({
  initialized: false,
  accounts: {},
  bindings: {},
  tickets: {},
  intents: {},
  consents: {},
});
const publicAccount = (a: Account) => ({
  account_id: a.account_id,
  name: a.name,
  role: a.role,
  enabled: a.enabled,
});
const key = (account: string, device: string) => `${account}/${device}`;
export class Directory extends DurableObject<DirectoryEnv> {
  async change<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
    const outcome = await this.ctx.blockConcurrencyWhile(async () => {
      const s = (await this.ctx.storage.get<State>("state")) ?? fresh();
      for (const map of [s.tickets, s.intents, s.consents])
        for (const [k, v] of Object.entries(map))
          if (v.expires < Date.now()) delete map[k];
      try {
        const result = await fn(s);
        if (new TextEncoder().encode(JSON.stringify(s)).length > 100_000)
          throw Error("Private deployment directory capacity reached");
        await this.ctx.storage.put("state", s);
        return { ok: true as const, result };
      } catch (error) {
        // Expected authorization errors must not reset the Durable Object.
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Operation failed",
        };
      }
    });
    if (!outcome.ok) throw Error(outcome.error);
    return outcome.result;
  }
  async state() {
    return (await this.ctx.storage.get<State>("state")) ?? fresh();
  }
  actor(s: State, identity: Identity) {
    const a = s.accounts[identity.accountId];
    if (!a?.enabled || a.generation !== identity.generation)
      throw Error("Authentication required");
    return a;
  }
  async authenticate(id: string, credential: string) {
    const h = await digest(credential),
      s = await this.state(),
      a = s.accounts[id];
    if (!a?.enabled || a.login_hash !== h) return null;
    return { accountId: id, generation: a.generation };
  }
  async identity(identity: Identity) {
    try {
      return publicAccount(this.actor(await this.state(), identity));
    } catch {
      return null;
    }
  }
  async bootstrap(credential: string, id: string, name: string) {
    identifier.parse(id);
    if (!name || name.length > 100) throw Error("Invalid name");
    if (
      !this.env.BOOTSTRAP_KEY_SHA256 ||
      (await digest(credential)) !== this.env.BOOTSTRAP_KEY_SHA256
    )
      throw Error("Bootstrap denied");
    const login = secret(),
      h = await digest(login);
    return this.change((s) => {
      if (s.initialized) throw Error("Already initialized");
      s.initialized = true;
      s.accounts[id] = {
        account_id: id,
        name,
        role: "admin",
        enabled: true,
        login_hash: h,
        generation: crypto.randomUUID(),
      };
      return {
        server_url: this.env.PUBLIC_URL,
        account_id: id,
        login_key: login,
      };
    });
  }
  async registered(account: string) {
    const s = await this.state();
    return s.accounts[account]?.enabled
      ? Object.values(s.bindings).filter((b) => b.account_id === account)
      : [];
  }
  async checkBinding(account: string, device: string, hash: string) {
    const s = await this.state(),
      b = s.bindings[key(account, device)];
    return s.accounts[account]?.enabled && b?.device_key_sha256 === hash
      ? b
      : null;
  }
  async limit(bucket: string, max: number) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const k = "rate:" + bucket,
        old = await this.ctx.storage.get<{ at: number; n: number }>(k),
        now = Date.now();
      const v = old && now - old.at < 60000 ? old : { at: now, n: 0 };
      v.n++;
      await this.ctx.storage.put(k, v);
      return v.n <= max;
    });
  }
  async consent(auth: AuthRequest) {
    return this.change((s) => {
      if (Object.keys(s.consents).length >= 100)
        throw Error("Too many requests");
      const id = crypto.randomUUID(),
        csrf = secret();
      s.consents[id] = { auth, csrf, expires: Date.now() + 300000 };
      return { id, csrf };
    });
  }
  async approve(id: string, csrf: string, account: string, credential: string) {
    const hash = await digest(credential);
    return this.change((s) => {
      const a = s.accounts[account],
        c = s.consents[id];
      if (!c || c.csrf !== csrf || !a?.enabled || a.login_hash !== hash)
        return null;
      delete s.consents[id];
      return {
        auth: c.auth,
        identity: { accountId: account, generation: a.generation },
      };
    });
  }
  async ticket(s: State, account: Account, value: unknown, binding?: Binding) {
    if (Object.keys(s.tickets).length >= 100)
      throw Error("Too many unclaimed credentials");
    const code = secret();
    s.tickets[await digest(code)] = {
      expires: Date.now() + 300000,
      value,
      account: account.account_id,
      generation: account.generation,
      bindingHash: binding?.device_key_sha256,
      device: binding?.device_id,
    };
    return {
      claim_url: this.env.PUBLIC_URL + "/claim#" + code,
      expires_in: 300,
      message:
        "在浏览器领取凭证，链接五分钟内有效且仅能使用一次。不要把领取的密钥粘贴到聊天中。",
    };
  }
  async claim(code: string) {
    const h = await digest(code);
    return this.change((s) => {
      const t = s.tickets[h];
      if (!t) throw Error("Claim expired or already used");
      const a = s.accounts[t.account];
      if (
        !a?.enabled ||
        a.generation !== t.generation ||
        (t.device &&
          s.bindings[key(t.account, t.device)]?.device_key_sha256 !==
            t.bindingHash)
      )
        throw Error("Claim revoked");
      delete s.tickets[h];
      return t.value;
    });
  }
  async manage(identity: Identity, input: unknown) {
    const p = manageSchema.parse(input);
    return this.change(async (s) => {
      const actor = this.actor(s, identity),
        target = p.account_id ?? actor.account_id;
      const adminOnly = [
        "list_accounts",
        "create_account",
        "disable_account",
        "enable_account",
        "set_role",
      ];
      if (
        (adminOnly.includes(p.action) || target !== actor.account_id) &&
        actor.role !== "admin"
      )
        throw Error("Administrator permission required");
      if (p.action === "me") return publicAccount(actor);
      if (p.action === "list_accounts")
        return { accounts: Object.values(s.accounts).map(publicAccount) };
      const a = s.accounts[target];
      if (p.action === "create_account") {
        if (!p.account_id || a) throw Error("Choose a new account_id");
        if (Object.keys(s.accounts).length >= 100)
          throw Error("Account limit reached");
        const login = secret();
        const created: Account = {
          account_id: target,
          name: p.name ?? target,
          role: "member",
          enabled: true,
          login_hash: await digest(login),
          generation: crypto.randomUUID(),
        };
        s.accounts[target] = created;
        return {
          account: publicAccount(created),
          ...(await this.ticket(s, created, {
            server_url: this.env.PUBLIC_URL,
            account_id: target,
            login_key: login,
          })),
        };
      }
      if (!a) throw Error("Account not found");
      const bk = p.device_id ? key(target, p.device_id) : "",
        binding = s.bindings[bk];
      const sensitive = [
        "disable_account",
        "enable_account",
        "set_role",
        "unbind_device",
        "rotate_login",
      ].includes(p.action);
      if (sensitive) {
        if (p.action === "set_role" && !p.role) throw Error("role is required");
        if (p.action === "unbind_device" && !binding)
          throw Error("Binding not found");
        const { confirmation_id, ...operation } = p,
          request = JSON.stringify(operation);
        if (!confirmation_id) {
          if (Object.keys(s.intents).length >= 100)
            throw Error("Too many pending confirmations");
          const id = crypto.randomUUID();
          s.intents[id] = {
            actor: actor.account_id,
            generation: actor.generation,
            expires: Date.now() + 120000,
            request,
            targetGeneration: a.generation,
            bindingHash: binding?.device_key_sha256,
          };
          return {
            confirmation_required: true,
            confirmation_id: id,
            operation: { ...operation, account_id: target },
            message:
              "请向用户说明操作对象与影响，获得确认后原样提交操作和 confirmation_id。",
            expires_in: 120,
          };
        }
        const intent = s.intents[confirmation_id];
        if (
          !intent ||
          intent.actor !== actor.account_id ||
          intent.generation !== actor.generation ||
          intent.request !== request ||
          intent.targetGeneration !== a.generation ||
          intent.bindingHash !== binding?.device_key_sha256
        )
          throw Error("Confirmation invalid or stale");
        delete s.intents[confirmation_id];
      }
      if (p.action === "list_devices")
        return {
          account_id: target,
          bindings: Object.values(s.bindings).filter(
            (b) => b.account_id === target,
          ),
        };
      if (p.action === "bind_device") {
        if (!a.enabled || !p.device_id || binding)
          throw Error("Choose an enabled account and a new device binding");
        if (
          Object.values(s.bindings).filter((b) => b.account_id === target)
            .length >= 100
        )
          throw Error("Device limit reached");
        const deviceKey = secret();
        const b = bindingSchema.parse({
          version: 1,
          server_url: this.env.PUBLIC_URL,
          account_id: target,
          device_id: p.device_id,
          device_name: p.name ?? p.device_id,
          device_key_sha256: await digest(deviceKey),
          tools: p.tools ?? ["read", "ls", "find", "grep"],
        });
        s.bindings[bk] = b;
        return {
          binding: b,
          ...(await this.ticket(
            s,
            a,
            { binding: b, device_key: deviceKey },
            b,
          )),
        };
      }
      if (p.action === "unbind_device") {
        delete s.bindings[bk];
        return { removed: true, account_id: target, device_id: p.device_id };
      }
      if (
        (p.action === "disable_account" ||
          (p.action === "set_role" && p.role === "member")) &&
        a.enabled &&
        a.role === "admin" &&
        Object.values(s.accounts).filter((x) => x.enabled && x.role === "admin")
          .length <= 1
      )
        throw Error("Cannot remove the last active administrator");
      if (p.action === "set_role") a.role = p.role!;
      if (p.action === "disable_account") {
        a.enabled = false;
        a.generation = crypto.randomUUID();
      }
      if (p.action === "enable_account") a.enabled = true;
      if (p.action === "rotate_login") {
        if (!a.enabled) throw Error("Account disabled");
        const login = secret();
        a.login_hash = await digest(login);
        a.generation = crypto.randomUUID();
        return await this.ticket(s, a, {
          server_url: this.env.PUBLIC_URL,
          account_id: target,
          login_key: login,
        });
      }
      return publicAccount(a);
    });
  }
}
