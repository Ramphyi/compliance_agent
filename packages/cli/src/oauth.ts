import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Request, Response } from "express";

const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_TTL_MS = 10 * 60_000;
const MAX_CLIENTS = 500;
const MAX_FAILURES = 5;

/** Who signed in: the reviewer's name and a hash of the Acai token they used (the grant). */
type Grant = { name: string; grant: string };
type TokenRecord = Grant & { type: "access" | "refresh"; clientId: string; scopes: string[]; expiresAt: number };
type Persisted = { clients: OAuthClientInformationFull[]; tokens: Record<string, TokenRecord> };
type Pending = { clientId: string; clientName: string; params: AuthorizationParams; expiresAt: number; failures: number };

export type OAuthOptions = {
  /** Where clients and token hashes persist, so connectors survive a restart. */
  file: string;
  /** The MCP endpoint, for example https://acai.example.com/mcp. */
  resource: URL;
  /** The account an Acai API token belongs to, or why it cannot connect an agent. */
  signIn: (token: string, context: { ip?: string; client: string }) => { name: string } | { error: string };
  /** Whether the Acai token behind a grant is still valid (not revoked or expired, account enabled, allowed to use MCP). */
  grantValid: (grant: string) => boolean;
};

export const hashToken = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const nowSec = () => Math.floor(Date.now() / 1000);
const comparable = (u: string | URL) => String(u).replace(/#.*$/, "").replace(/\/$/, "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * OAuth 2.1 authorization server for remote MCP clients that cannot send a static bearer token
 * (ChatGPT connectors, Claude.ai connectors). Clients register dynamically; the person approves
 * on a consent page by entering their Acai API token, and the client then gets short-lived access
 * tokens bound to that token: revoking it, or disabling the account, ends the client's access.
 */
export class AcaiOAuth implements OAuthServerProvider {
  private data: Persisted;
  private pending = new Map<string, Pending>();
  private codes = new Map<string, Grant & { clientId: string; params: AuthorizationParams; expiresAt: number }>();

  constructor(private opts: OAuthOptions) {
    this.data = this.load();
  }

  get metadataUrl() {
    const u = this.opts.resource;
    return new URL(`/.well-known/oauth-protected-resource${u.pathname === "/" ? "" : u.pathname}`, u).href;
  }

  private load(): Persisted {
    try {
      const d = JSON.parse(readFileSync(this.opts.file, "utf8")) as Partial<Persisted>;
      return { clients: d.clients ?? [], tokens: d.tokens ?? {} };
    } catch {
      return { clients: [], tokens: {} };
    }
  }

  private save() {
    const t = nowSec();
    for (const [k, r] of Object.entries(this.data.tokens)) if (r.expiresAt < t) delete this.data.tokens[k];
    if (this.data.clients.length > MAX_CLIENTS) {
      // Drop the oldest clients that hold no tokens; clients in use are kept.
      const inUse = new Set(Object.values(this.data.tokens).map((r) => r.clientId));
      let excess = this.data.clients.length - MAX_CLIENTS;
      this.data.clients = this.data.clients.filter((c) => excess <= 0 || inUse.has(c.client_id) || excess-- <= 0);
    }
    mkdirSync(dirname(this.opts.file), { recursive: true });
    const tmp = `${this.opts.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.opts.file);
  }

  private sweep() {
    const t = Date.now();
    for (const [k, p] of this.pending) if (p.expiresAt < t) this.pending.delete(k);
    for (const [k, c] of this.codes) if (c.expiresAt < t) this.codes.delete(k);
  }

  private checkResource(resource?: URL) {
    if (resource && ![this.opts.resource.href, this.opts.resource.origin].map(comparable).includes(comparable(resource)))
      throw new InvalidTargetError(`This server only issues tokens for ${this.opts.resource.href}`);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (id) => this.data.clients.find((c) => c.client_id === id),
      // The SDK's registration handler has already generated client_id (and a secret for confidential clients).
      registerClient: (client) => {
        const full = client as OAuthClientInformationFull;
        this.data.clients.push(full);
        this.save();
        return full;
      },
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    this.checkResource(params.resource);
    this.sweep();
    const id = secret();
    const p: Pending = { clientId: client.client_id, clientName: client.client_name || "An MCP client", params, expiresAt: Date.now() + REQUEST_TTL_MS, failures: 0 };
    this.pending.set(id, p);
    this.consentPage(res, id, p);
  }

  /** POST /oauth/consent: the person approves with their Acai token, or denies. */
  consent(req: Request, res: Response) {
    this.sweep();
    const body = (req.body ?? {}) as Record<string, string>;
    const id = String(body.request ?? "");
    const p = this.pending.get(id);
    if (!p) return void res.status(400).type("text").send("This sign-in request has expired or was already used. Connect again from your MCP client.");
    const back = new URL(p.params.redirectUri);
    if (p.params.state) back.searchParams.set("state", p.params.state);
    if (body.action === "deny") {
      this.pending.delete(id);
      back.searchParams.set("error", "access_denied");
      return void res.redirect(302, back.href);
    }
    const token = String(body.token ?? "").trim();
    const signedIn = token ? this.opts.signIn(token, { ip: req.ip, client: p.clientName }) : { error: "Enter your Acai API token." };
    if ("error" in signedIn) {
      if (++p.failures >= MAX_FAILURES) {
        this.pending.delete(id);
        return void res.status(401).type("text").send("Too many failed attempts. Connect again from your MCP client.");
      }
      return void this.consentPage(res.status(401), id, p, signedIn.error);
    }
    this.pending.delete(id);
    const code = secret();
    this.codes.set(code, { clientId: p.clientId, params: p.params, name: signedIn.name, grant: hashToken(token), expiresAt: Date.now() + CODE_TTL_MS });
    back.searchParams.set("code", code);
    res.redirect(302, back.href);
  }

  private code(client: OAuthClientInformationFull, code: string) {
    const c = this.codes.get(code);
    if (!c || c.clientId !== client.client_id || c.expiresAt < Date.now()) throw new InvalidGrantError("Invalid or expired authorization code");
    return c;
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) {
    return this.code(client, code).params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const c = this.code(client, code);
    this.codes.delete(code);
    if (redirectUri && redirectUri !== c.params.redirectUri) throw new InvalidGrantError("redirect_uri does not match the authorization request");
    this.checkResource(resource);
    return this.issue(client.client_id, c, c.params.scopes ?? []);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const key = hashToken(refreshToken);
    const r = this.data.tokens[key];
    if (!r || r.type !== "refresh" || r.clientId !== client.client_id || r.expiresAt < nowSec() || !this.opts.grantValid(r.grant))
      throw new InvalidGrantError("Invalid or expired refresh token");
    if (scopes?.some((s) => !r.scopes.includes(s))) throw new InvalidScopeError("Cannot widen the granted scopes");
    this.checkResource(resource);
    delete this.data.tokens[key]; // rotation: a refresh token works once
    return this.issue(client.client_id, r, scopes ?? r.scopes);
  }

  private issue(clientId: string, g: Grant, scopes: string[]): OAuthTokens {
    const access = secret();
    const refresh = secret();
    const base = { name: g.name, grant: g.grant, clientId, scopes };
    this.data.tokens[hashToken(access)] = { ...base, type: "access", expiresAt: nowSec() + ACCESS_TTL };
    this.data.tokens[hashToken(refresh)] = { ...base, type: "refresh", expiresAt: nowSec() + REFRESH_TTL };
    this.save();
    return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: scopes.join(" ") || undefined };
  }

  /** The grant (hash of the Acai token the person approved with) and client behind an access token, or null. */
  lookup(token: string): { name: string; grant: string; client: string } | null {
    const r = this.data.tokens[hashToken(token)];
    if (!r || r.type !== "access" || r.expiresAt < nowSec() || !this.opts.grantValid(r.grant)) return null;
    return { name: r.name, grant: r.grant, client: this.data.clients.find((c) => c.client_id === r.clientId)?.client_name || "OAuth client" };
  }

  /** Drop every access and refresh token issued for these grants (signing a person out of their connectors). */
  revokeGrants(grants: Iterable<string>) {
    const set = new Set(grants);
    let n = 0;
    for (const [k, r] of Object.entries(this.data.tokens))
      if (set.has(r.grant)) {
        delete this.data.tokens[k];
        n++;
      }
    if (n) this.save();
    return n;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const r = this.data.tokens[hashToken(token)];
    if (!r || !this.lookup(token)) throw new InvalidTokenError("Invalid or expired token");
    return { token, clientId: r.clientId, scopes: r.scopes, expiresAt: r.expiresAt, resource: this.opts.resource, extra: { name: r.name } };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const key = hashToken(request.token);
    if (this.data.tokens[key]?.clientId === client.client_id) {
      delete this.data.tokens[key];
      this.save();
    }
  }

  private consentPage(res: Response, id: string, p: Pending, error?: string) {
    const to = new URL(p.params.redirectUri);
    // The approval redirects to the client, so the form may navigate to its origin (or app scheme).
    const target = /^https?:$/.test(to.protocol) ? to.origin : to.protocol;
    res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${target}; frame-ancestors 'none'; base-uri 'none'`);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to Acai</title>
<style>
:root{--bg:#f6f8f8;--card:#fff;--fg:#0f1a1c;--dim:#5b6b6e;--line:#d9e2e3;--accent:#0f8b8d;--err:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0d1415;--card:#152023;--fg:#e6eeef;--dim:#93a5a8;--line:#24363a;--accent:#3cc3c5;--err:#f97066}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
main{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;max-width:440px;width:100%}
h1{font-size:18px;margin:0 0 16px}h1 span{color:var(--accent)}p{margin:0 0 12px}.dim{color:var(--dim);font-size:14px}.err{color:var(--err)}
label{display:block;font-size:14px;margin:16px 0 4px}input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.row{display:flex;gap:8px;margin-top:20px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;font:inherit;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--line)}code{font-size:13px}
</style></head><body><main>
<h1><span>◆</span> Acai</h1>
<p><b>${esc(p.clientName)}</b> wants to use Acai on your behalf.</p>
<p class="dim">It will be able to list the projects on this server, run audits, record findings, read project files and relay your review decisions. It returns to <code>${esc(to.host || to.protocol)}</code>. Only continue if you started this connection.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/oauth/consent">
<input type="hidden" name="request" value="${esc(id)}">
<label for="token">Your Acai API token</label><input id="token" name="token" type="password" autocomplete="current-password" autofocus>
<p class="dim" style="margin-top:6px">Create one in the Acai dashboard under Account, or ask your administrator. Revoking it later disconnects this client.</p>
<div class="row"><button name="action" value="allow">Allow</button><button class="secondary" name="action" value="deny">Deny</button></div>
</form></main></body></html>`);
  }
}
