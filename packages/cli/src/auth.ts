import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Accounts for a shared Acai server: users with roles, API tokens, dashboard sessions and a
 * short event log, persisted in $ACAI_HOME/auth.json (mode 600). Only SHA-256 hashes of tokens
 * and sessions are stored. The file is re-read when it changes on disk, so `acai users` and
 * `acai tokens` apply to a running server.
 *
 * Accounts from the environment (ACAI_TOKENS, ACAI_TOKEN) are read-only and live in memory only.
 */

export type Role = "admin" | "member" | "viewer";
export const ROLES: readonly Role[] = ["admin", "member", "viewer"];

export type UserInfo = { id: string; name: string; role: Role; disabled: boolean; source: "local" | "env"; createdAt: string; lastSeenAt?: string; tokens: number; sessions: number };
export type TokenInfo = { id: string; userId: string; userName: string; label: string; prefix: string; createdAt: string; lastUsedAt?: string; expiresAt?: string };
export type AuthEvent = { at: string; actor: string; action: string; target?: string; ip?: string };
/** A signed-in account, and the token it signed in with. */
export type Account = { id: string; name: string; role: Role; source: "local" | "env"; tokenId: string };
/** Who makes a change, for the event log and the checks on one's own account. */
export type ChangedBy = { name: string; ip?: string; userId?: string };

type User = { id: string; name: string; role: Role; disabled: boolean; createdAt: string; lastSeenAt?: string; source?: "env" };
type Token = { id: string; userId: string; label: string; prefix: string; hash: string; createdAt: string; lastUsedAt?: string; expiresAt?: string; source?: "env" };
type Session = { hash: string; userId: string; tokenId: string; createdAt: string; expiresAt: string; ip?: string };
type AuthData = { version: 1; users: User[]; tokens: Token[]; sessions: Session[]; events: AuthEvent[] };

export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    message: string,
  ) {
    super(message);
  }
}

export const TOKEN_PREFIX = "acai_";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const MIN_TOKEN_LENGTH = 16;
const TOUCH_MS = 60_000;
const MAX_EVENTS = 1000;
const MAX_SESSIONS_PER_USER = 20;
const MAX_TOKENS_PER_USER = 50;
const MAX_TOKEN_DAYS = 3650;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** A new API token: `acai_` and 32 random bytes, base64url. */
export const newApiToken = () => TOKEN_PREFIX + randomBytes(32).toString("base64url");
const newId = (kind: "u" | "t") => `${kind}_${randomBytes(6).toString("hex")}`;
/** The part of a token that may be shown again: only for generated tokens, never for tokens a person chose. */
const displayPrefix = (token: string) => (token.startsWith(TOKEN_PREFIX) ? token.slice(0, 12) : "");
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const expired = (at: string | undefined, now = Date.now()) => Boolean(at && Date.parse(at) <= now);
const list = (v: string | undefined, sep = ",") => (v ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
const empty = (): AuthData => ({ version: 1, users: [], tokens: [], sessions: [], events: [] });

export function validName(raw: unknown): string {
  const name = String(raw ?? "").trim();
  if (!name || name.length > 80) throw new AuthError(400, "A name has 1 to 80 characters.");
  if (/[\u0000-\u001f\u007f,:]/.test(name)) throw new AuthError(400, "A name cannot contain commas, colons or control characters.");
  return name;
}

export function validRole(raw: unknown): Role {
  if (!ROLES.includes(raw as Role)) throw new AuthError(400, `The role must be one of: ${ROLES.join(", ")}.`);
  return raw as Role;
}

function validDays(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_TOKEN_DAYS) throw new AuthError(400, `expiresInDays must be between 1 and ${MAX_TOKEN_DAYS}.`);
  return n;
}

/** Accounts from ACAI_TOKENS (name:token,...) and ACAI_TOKEN (one account named admin). */
function envAccounts(env: NodeJS.ProcessEnv, startedAt: string): { users: User[]; tokens: Token[] } {
  const admins = list(env.ACAI_ADMINS);
  const role = (name: string): Role => (!admins.length || admins.includes(name) ? "admin" : "member");
  const users = new Map<string, User>();
  const tokens: Token[] = [];
  const add = (name: string, token: string, from: string) => {
    const hash = sha256(token);
    if (tokens.some((t) => t.hash === hash)) throw new Error(`${from}: the same token is given to more than one account`);
    const id = `env-${sha256(`user:${name}`).slice(0, 10)}`;
    if (!users.has(id)) users.set(id, { id, name, role: role(name), disabled: false, createdAt: startedAt, source: "env" });
    tokens.push({ id: `env-${sha256(`token:${hash}`).slice(0, 10)}`, userId: id, label: from, prefix: displayPrefix(token), hash, createdAt: startedAt, source: "env" });
  };
  list(env.ACAI_TOKENS).forEach((pair, i) => {
    const at = pair.indexOf(":");
    const name = at > 0 ? pair.slice(0, at).trim() : "";
    const token = at > 0 ? pair.slice(at + 1).trim() : "";
    if (!name || token.length < MIN_TOKEN_LENGTH) throw new Error(`ACAI_TOKENS entry ${i + 1} must be name:token with a token of at least ${MIN_TOKEN_LENGTH} characters`);
    try {
      validName(name);
    } catch (e) {
      throw new Error(`ACAI_TOKENS entry ${i + 1}: ${(e as Error).message}`);
    }
    add(name, token, "ACAI_TOKENS");
  });
  const shared = env.ACAI_TOKEN?.trim();
  if (shared) {
    if (shared.length < MIN_TOKEN_LENGTH) throw new Error(`ACAI_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    add("admin", shared, "ACAI_TOKEN");
  }
  return { users: [...users.values()], tokens };
}

function normalize(raw: unknown): AuthData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<AuthData>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    version: 1,
    users: arr<User>(d.users).filter((u) => u && typeof u.id === "string" && typeof u.name === "string" && ROLES.includes(u.role)).map((u) => ({ ...u, disabled: Boolean(u.disabled), source: undefined })),
    tokens: arr<Token>(d.tokens).filter((t) => t && typeof t.id === "string" && typeof t.hash === "string" && typeof t.userId === "string").map((t) => ({ ...t, source: undefined })),
    sessions: arr<Session>(d.sessions).filter((s) => s && typeof s.hash === "string" && typeof s.userId === "string"),
    events: arr<AuthEvent>(d.events).filter((e) => e && typeof e.at === "string" && typeof e.action === "string"),
  };
}

export type AuthStoreOptions = { file: string; env?: NodeJS.ProcessEnv };

export class AuthStore {
  readonly file: string;
  private data: AuthData = empty();
  /** File identity of what is loaded (inode, size, mtime); a different one means another process wrote it. */
  private signature: string | undefined;
  private env: { users: User[]; tokens: Token[] };
  private users = new Map<string, User>();
  private byHash = new Map<string, Token>();
  private byId = new Map<string, Token>();
  private sessions = new Map<string, Session>();
  private warnedWrite = false;
  /** Inside a change: the data in memory is what gets written, so it must not be reloaded. */
  private changing = false;

  constructor(opts: AuthStoreOptions) {
    this.file = opts.file;
    this.env = envAccounts(opts.env ?? process.env, iso());
    this.sync(true);
  }

  // ------------------------------------------------------------------ storage

  private sync(first = false) {
    if (this.changing) return;
    let sig = "missing";
    try {
      const st = statSync(this.file);
      sig = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      /* no file yet: no local accounts */
    }
    if (sig === this.signature) return;
    if (sig === "missing") this.data = empty();
    else {
      try {
        this.data = normalize(JSON.parse(readFileSync(this.file, "utf8")));
      } catch (e) {
        const msg = `${this.file} could not be read (${(e as Error).message}). Fix it or restore it from a backup.`;
        if (first) throw new Error(msg);
        console.error(`[acai] ${msg} Keeping the accounts loaded before.`);
        return;
      }
    }
    this.signature = sig;
    this.index();
  }

  private index() {
    this.users = new Map([...this.env.users, ...this.data.users].map((u) => [u.id, u]));
    const all = [...this.env.tokens, ...this.data.tokens];
    this.byHash = new Map(all.map((t) => [t.hash, t]));
    this.byId = new Map(all.map((t) => [t.id, t]));
    this.sessions = new Map(this.data.sessions.map((s) => [s.hash, s]));
  }

  private save() {
    const now = Date.now();
    this.index();
    this.data.sessions = this.data.sessions.filter((s) => !expired(s.expiresAt, now) && this.byId.has(s.tokenId) && this.users.has(s.userId));
    if (this.data.events.length > MAX_EVENTS) this.data.events = this.data.events.slice(-MAX_EVENTS);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ ...this.data, users: this.data.users.map(({ source: _s, ...u }) => u), tokens: this.data.tokens.map(({ source: _s, ...t }) => t) }, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to clean up */
      }
      throw e;
    }
    const st = statSync(this.file);
    this.signature = `${st.ino}:${st.size}:${st.mtimeMs}`;
    this.index();
  }

  /** Re-read, change, write: changes made by another process in between are kept. */
  private mutate<T>(fn: () => T): T {
    this.sync();
    this.changing = true;
    try {
      const out = fn();
      this.save();
      return out;
    } catch (e) {
      // A refused change leaves nothing half-done in memory: reload what is on disk.
      this.signature = undefined;
      throw e;
    } finally {
      this.changing = false;
      if (this.signature === undefined) this.sync();
    }
  }

  private event(by: ChangedBy, action: string, target?: string) {
    this.data.events.push({ at: iso(), actor: by.name, action, ...(target ? { target } : {}), ...(by.ip ? { ip: by.ip } : {}) });
  }

  /** Record an event on its own (sign-in failures, OAuth grants). */
  log(by: ChangedBy, action: string, target?: string) {
    try {
      this.mutate(() => this.event(by, action, target));
    } catch (e) {
      this.warnWrite(e);
    }
  }

  private warnWrite(e: unknown) {
    if (this.warnedWrite) return;
    this.warnedWrite = true;
    console.error(`[acai] could not write ${this.file}: ${(e as Error).message}`);
  }

  // ------------------------------------------------------------------ lookups

  /** Whether any account exists (local or from the environment): then the server requires sign-in. */
  hasAccounts() {
    this.sync();
    return this.users.size > 0;
  }

  private usable(t: Token | undefined, now = Date.now()) {
    if (!t || expired(t.expiresAt, now)) return null;
    const u = this.users.get(t.userId);
    return u && !u.disabled ? u : null;
  }

  private account(u: User, t: Token): Account {
    return { id: u.id, name: u.name, role: u.role, source: u.source ?? "local", tokenId: t.id };
  }

  /** Last use of tokens and accounts, written at most once a minute per token. */
  private touch(t: Token, u: User) {
    const now = Date.now();
    let dirty = false;
    if (!t.lastUsedAt || now - Date.parse(t.lastUsedAt) >= TOUCH_MS) {
      t.lastUsedAt = iso(now);
      dirty ||= !t.source;
    }
    if (!u.lastSeenAt || now - Date.parse(u.lastSeenAt) >= TOUCH_MS) {
      u.lastSeenAt = iso(now);
      dirty ||= !u.source;
    }
    if (!dirty) return;
    try {
      this.save();
    } catch (e) {
      this.warnWrite(e);
    }
  }

  /** The account an API token (or a token hash, for OAuth grants) belongs to, or null. */
  authenticate(token: string): Account | null {
    if (!token || token.length > 512) return null;
    return this.byTokenHash(sha256(token));
  }

  byTokenHash(hash: string): Account | null {
    this.sync();
    const t = this.byHash.get(hash);
    const u = this.usable(t);
    if (!t || !u) return null;
    this.touch(t, u);
    return this.account(u, t);
  }

  /** The account behind a dashboard session cookie. The session ends with the token it was opened with. */
  session(value: string): Account | null {
    if (!value || value.length > 512) return null;
    this.sync();
    const s = this.sessions.get(sha256(value));
    if (!s || expired(s.expiresAt)) return null;
    const t = this.byId.get(s.tokenId);
    const u = this.usable(t);
    if (!t || !u || u.id !== s.userId) return null;
    this.touch(t, u);
    return this.account(u, t);
  }

  // ------------------------------------------------------------------ sessions

  /** Exchange an API token for a dashboard session. Returns null (and logs it) for an invalid token. */
  login(token: string, ip?: string): { session: string; account: Account; maxAgeSec: number } | null {
    const account = this.authenticate(token);
    if (!account) {
      this.log({ name: "unknown", ip }, "login.failed");
      return null;
    }
    const session = randomBytes(32).toString("base64url");
    this.mutate(() => {
      const now = Date.now();
      const mine = this.data.sessions.filter((s) => s.userId === account.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const drop = new Set(mine.slice(0, Math.max(0, mine.length - MAX_SESSIONS_PER_USER + 1)).map((s) => s.hash));
      this.data.sessions = this.data.sessions.filter((s) => !drop.has(s.hash));
      this.data.sessions.push({ hash: sha256(session), userId: account.id, tokenId: account.tokenId, createdAt: iso(now), expiresAt: iso(now + SESSION_TTL_MS), ...(ip ? { ip } : {}) });
      this.event({ name: account.name, ip }, "login");
    });
    return { session, account, maxAgeSec: SESSION_TTL_MS / 1000 };
  }

  logout(value: string, ip?: string) {
    if (!value) return;
    this.sync();
    const s = this.sessions.get(sha256(value));
    if (!s) return;
    this.mutate(() => {
      this.data.sessions = this.data.sessions.filter((x) => x.hash !== s.hash);
      this.event({ name: this.users.get(s.userId)?.name ?? "unknown", ip }, "logout");
    });
  }

  // ------------------------------------------------------------------ views

  private userInfoOf(u: User): UserInfo {
    const now = Date.now();
    return {
      id: u.id,
      name: u.name,
      role: u.role,
      disabled: u.disabled,
      source: u.source ?? "local",
      createdAt: u.createdAt,
      ...(u.lastSeenAt ? { lastSeenAt: u.lastSeenAt } : {}),
      tokens: [...this.byId.values()].filter((t) => t.userId === u.id && !expired(t.expiresAt, now)).length,
      sessions: this.data.sessions.filter((s) => s.userId === u.id && !expired(s.expiresAt, now)).length,
    };
  }

  private tokenInfoOf(t: Token): TokenInfo {
    return {
      id: t.id,
      userId: t.userId,
      userName: this.users.get(t.userId)?.name ?? "(deleted)",
      label: t.label,
      prefix: t.prefix,
      createdAt: t.createdAt,
      ...(t.lastUsedAt ? { lastUsedAt: t.lastUsedAt } : {}),
      ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}),
    };
  }

  listUsers(): UserInfo[] {
    this.sync();
    return [...this.users.values()].sort((a, b) => a.name.localeCompare(b.name)).map((u) => this.userInfoOf(u));
  }

  userInfo(id: string): UserInfo {
    return this.userInfoOf(this.user(id));
  }

  /** A user by id, or by name (case-insensitive) for the CLI. */
  user(idOrName: string): User {
    this.sync();
    const u = this.users.get(idOrName) ?? [...this.users.values()].find((x) => x.name.toLowerCase() === idOrName.toLowerCase());
    if (!u) throw new AuthError(404, `User not found: ${idOrName}`);
    return u;
  }

  listTokens(userId?: string): TokenInfo[] {
    this.sync();
    return [...this.byId.values()].filter((t) => !userId || t.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => this.tokenInfoOf(t));
  }

  events(limit = MAX_EVENTS): AuthEvent[] {
    this.sync();
    return this.data.events.slice(-limit).reverse();
  }

  /** Token hashes of a user's tokens (OAuth grants are keyed by them). */
  grantsOf(userId: string): string[] {
    this.sync();
    return [...this.byId.values()].filter((t) => t.userId === userId).map((t) => t.hash);
  }

  enabledAdmins(): number {
    this.sync();
    return [...this.users.values()].filter((u) => u.role === "admin" && !u.disabled).length;
  }

  // ------------------------------------------------------------------ changes

  private local(u: User, what: string) {
    if (u.source === "env") throw new AuthError(409, `${u.name} is defined in the server environment (ACAI_TOKENS or ACAI_TOKEN) and cannot be ${what} here. Change the environment and restart.`);
  }

  private assertUniqueName(name: string, exceptId?: string) {
    const clash = [...this.users.values()].find((u) => u.id !== exceptId && u.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new AuthError(409, `A user named ${clash.name} already exists.`);
  }

  private issue(u: User, label: string, days: number | undefined): { token: string; info: TokenInfo } {
    if (this.data.tokens.filter((t) => t.userId === u.id).length >= MAX_TOKENS_PER_USER) throw new AuthError(409, `${u.name} already has ${MAX_TOKENS_PER_USER} tokens. Revoke some first.`);
    const token = newApiToken();
    const now = Date.now();
    const t: Token = { id: newId("t"), userId: u.id, label, prefix: displayPrefix(token), hash: sha256(token), createdAt: iso(now), ...(days ? { expiresAt: iso(now + days * 86_400_000) } : {}) };
    this.data.tokens.push(t);
    this.byId.set(t.id, t);
    return { token, info: this.tokenInfoOf(t) };
  }

  createUser(input: { name: unknown; role?: unknown }, by: ChangedBy): { user: UserInfo; token: string } {
    return this.mutate(() => {
      const name = validName(input.name);
      const role = validRole(input.role ?? "member");
      this.assertUniqueName(name);
      const u: User = { id: newId("u"), name, role, disabled: false, createdAt: iso() };
      this.data.users.push(u);
      this.users.set(u.id, u);
      const { token } = this.issue(u, "First token", undefined);
      this.event(by, "user.create", `${name} (${role})`);
      return { user: this.userInfoOf(u), token };
    });
  }

  updateUser(id: string, patch: { name?: unknown; role?: unknown; disabled?: unknown }, by: ChangedBy): UserInfo {
    return this.mutate(() => {
      const u = this.user(id);
      this.local(u, "changed");
      const name = patch.name === undefined ? u.name : validName(patch.name);
      const role = patch.role === undefined ? u.role : validRole(patch.role);
      if (patch.disabled !== undefined && typeof patch.disabled !== "boolean") throw new AuthError(400, "disabled must be true or false.");
      const disabled = patch.disabled === undefined ? u.disabled : (patch.disabled as boolean);
      if (name !== u.name) this.assertUniqueName(name, u.id);
      const losesAdmin = u.role === "admin" && !u.disabled && (role !== "admin" || disabled);
      if (losesAdmin && by.userId === u.id) throw new AuthError(409, "You cannot remove your own administrator role or disable your own account.");
      if (losesAdmin && this.enabledAdmins() <= 1) throw new AuthError(409, `${u.name} is the last enabled administrator.`);
      const changes = [
        name !== u.name && `renamed from ${u.name}`,
        role !== u.role && `role ${role}`,
        disabled !== u.disabled && (disabled ? "disabled" : "enabled"),
      ].filter(Boolean);
      Object.assign(u, { name, role, disabled });
      // Disabling signs the person out everywhere.
      if (disabled) this.data.sessions = this.data.sessions.filter((s) => s.userId !== u.id);
      if (changes.length) this.event(by, "user.update", `${name}: ${changes.join(", ")}`);
      return this.userInfoOf(u);
    });
  }

  deleteUser(id: string, by: ChangedBy) {
    this.mutate(() => {
      const u = this.user(id);
      this.local(u, "deleted");
      if (by.userId === u.id) throw new AuthError(409, "You cannot delete your own account.");
      if (u.role === "admin" && !u.disabled && this.enabledAdmins() <= 1) throw new AuthError(409, `${u.name} is the last enabled administrator.`);
      this.data.users = this.data.users.filter((x) => x.id !== u.id);
      this.data.tokens = this.data.tokens.filter((t) => t.userId !== u.id);
      this.data.sessions = this.data.sessions.filter((s) => s.userId !== u.id);
      this.users.delete(u.id);
      this.event(by, "user.delete", u.name);
    });
  }

  /** End every dashboard session of a user. Returns how many there were. */
  signOut(id: string, by: ChangedBy): number {
    return this.mutate(() => {
      const u = this.user(id);
      const before = this.data.sessions.length;
      this.data.sessions = this.data.sessions.filter((s) => s.userId !== u.id);
      this.event(by, "user.signout", u.name);
      return before - this.data.sessions.length;
    });
  }

  createToken(userId: string, input: { label?: unknown; expiresInDays?: unknown }, by: ChangedBy): { token: string; info: TokenInfo } {
    return this.mutate(() => {
      const u = this.user(userId);
      if (u.source === "env") throw new AuthError(409, `${u.name} signs in with the token set in the server environment; it cannot have extra tokens.`);
      const label = String(input.label ?? "").trim().slice(0, 80) || "API token";
      const out = this.issue(u, label, validDays(input.expiresInDays));
      this.event(by, "token.create", `${u.name}: ${label} (${out.info.prefix || out.info.id})`);
      return out;
    });
  }

  /** Revoke a token by id or display prefix. With `userId`, only that user's tokens. Ends the sessions opened with it. */
  revokeToken(idOrPrefix: string, by: ChangedBy, opts: { userId?: string } = {}): TokenInfo {
    return this.mutate(() => {
      const key = idOrPrefix.trim();
      const candidates = [...this.byId.values()].filter((t) => !opts.userId || t.userId === opts.userId);
      let t = candidates.find((x) => x.id === key);
      if (!t && key.length >= 6) {
        const matches = candidates.filter((x) => (x.prefix && x.prefix.startsWith(key)) || x.id.startsWith(key));
        if (matches.length > 1) throw new AuthError(409, `${key} matches ${matches.length} tokens; give more characters or the id.`);
        t = matches[0];
      }
      if (!t) throw new AuthError(404, key.length < 6 ? `Token not found: ${key}. Give its id, or at least 6 characters of its prefix.` : `Token not found: ${key}`);
      const info = this.tokenInfoOf(t);
      if (t.source === "env") throw new AuthError(409, `This token is set in the server environment (${t.label}). Remove it there and restart.`);
      this.data.tokens = this.data.tokens.filter((x) => x.id !== t!.id);
      this.data.sessions = this.data.sessions.filter((s) => s.tokenId !== t!.id);
      this.byId.delete(t.id);
      this.event(by, "token.revoke", `${info.userName}: ${t.label} (${t.prefix || t.id})`);
      return info;
    });
  }

  /**
   * First administrator for a new server: when no enabled local administrator exists, create the
   * local user `admin` whose token is ACAI_ADMIN_TOKEN. Returns the name when it acted.
   */
  bootstrap(adminToken: string | undefined): string | null {
    const token = adminToken?.trim();
    if (!token) return null;
    if (token.length < MIN_TOKEN_LENGTH) throw new Error(`ACAI_ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    const hash = sha256(token);
    this.sync();
    if (this.data.users.some((u) => u.role === "admin" && !u.disabled)) return null;
    if (this.byHash.get(hash)?.source === "env") throw new Error("ACAI_ADMIN_TOKEN is also used in ACAI_TOKENS or ACAI_TOKEN; use a different value");
    const by = { name: "system" };
    return this.mutate(() => {
      // The token still belongs to a local user (a former administrator): restore that user.
      const existing = this.data.tokens.find((t) => t.hash === hash);
      const owner = existing && this.data.users.find((u) => u.id === existing.userId);
      if (existing && owner) {
        Object.assign(owner, { role: "admin", disabled: false });
        delete existing.expiresAt;
        this.event(by, "user.update", `${owner.name}: role admin, enabled (ACAI_ADMIN_TOKEN)`);
        return owner.name;
      }
      let name = "admin";
      for (let i = 2; [...this.users.values()].some((u) => u.name.toLowerCase() === name); i++) name = `admin-${i}`;
      const u: User = { id: newId("u"), name, role: "admin", disabled: false, createdAt: iso() };
      this.data.users.push(u);
      this.users.set(u.id, u);
      this.data.tokens = this.data.tokens.filter((t) => t.hash !== hash);
      this.data.tokens.push({ id: newId("t"), userId: u.id, label: "ACAI_ADMIN_TOKEN", prefix: displayPrefix(token), hash, createdAt: iso() });
      this.event(by, "user.create", `${name} (admin, from ACAI_ADMIN_TOKEN)`);
      return name;
    });
  }
}
