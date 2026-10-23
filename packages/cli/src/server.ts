import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import type { Server } from "node:http";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type Actor, ALL_CHECKS, ARTIFACTS, BATCHES, CATEGORY_LABELS, confine, createProvider, type FindingDraft, fixFinding, investigate, isSensitivePath, listModels,
  presetById, PROVIDER_PRESETS,
  currentBranch, fixTasks, isGitRepo, type LlmProvider, redactSecrets, tasksMarkdown, reinvestigate, report, research, ReviewError, summarize, understandProduct, type Workspace,
} from "@acai/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { CLIENT_LABELS, CLIENTS, connectGuide, launcher, REMOTE_ONLY } from "./connect";
import { configFromSettings, defaultBaseURL, type ModelSettings, readModelSettings, resolveProviderConfig, writeModelSettings } from "./models";
import { Jobs } from "./jobs";
import { type Provider, Webhooks } from "./webhooks";
import { type Account, AuthError, AuthStore, type ChangedBy, type Role } from "./auth";
import { createMcpServer } from "./mcp";
import { AcaiOAuth } from "./oauth";
import { acaiHome, type Projects } from "./projects";

export const VERSION = "0.1.0";

export type ServerOptions = {
  projects: Projects;
  provider: LlmProvider | null;
  host: string;
  port: number;
  dashboardDir?: string;
  allowInsecure?: boolean;
  /** Why the configured model could not be set up (shown on the Model page). */
  providerError?: string;
};

/** Who a request acts as, and what that account may do. Without accounts, the local user may do everything. */
type Who = { actor: Actor; account: Account | null; role: Role; oauthClient?: string };

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/;
const SESSION_COOKIE = "acai_session";
/** The cookie earlier versions kept the raw token in. */
const CLEAR_LEGACY_COOKIE = "acai_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
const names = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

function cookie(req: Request, name: string) {
  const c = req.headers.cookie?.split(/;\s*/).find((x) => x.startsWith(`${name}=`));
  if (!c) return undefined;
  try {
    return decodeURIComponent(c.slice(name.length + 1));
  } catch {
    return undefined;
  }
}

/** Failed sign-ins per client address: after `max` within a minute, further attempts are refused until it passes. */
class FailureLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(
    private max = 10,
    private windowMs = 60_000,
  ) {}
  blocked(key = "unknown") {
    const h = this.hits.get(key);
    return Boolean(h && h.until > Date.now() && h.n >= this.max);
  }
  fail(key = "unknown") {
    const now = Date.now();
    let h = this.hits.get(key);
    if (!h || h.until <= now) h = { n: 0, until: now + this.windowMs };
    h.n++;
    this.hits.set(key, h);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
  }
}
const TOO_MANY = "Too many failed sign-ins from this address. Wait a minute and try again.";

export function findDashboardDir(explicit?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, process.env.ACAI_DASHBOARD_DIR, join(here, "dashboard"), join(here, "../../dashboard/dist"), join(here, "../dashboard/dist")].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, "index.html")));
}

export function createApp(opts: ServerOptions) {
  const startedAt = Date.now();
  const auth = new AuthStore({ file: join(acaiHome(), "auth.json") });
  const bootstrapped = auth.bootstrap(process.env.ACAI_ADMIN_TOKEN);
  if (bootstrapped)
    console.log(`[acai] Created the administrator account "${bootstrapped}" from ACAI_ADMIN_TOKEN. Sign in with that token, create personal tokens, then revoke it.`);
  // Sign-in is on as soon as any account exists, and stays on even if every account is removed later.
  let authOn = false;
  const authMode = (): "none" | "tokens" => ((authOn ||= auth.hasAccounts()) ? "tokens" : "none");
  authMode();
  const limiter = new FailureLimiter();
  const jobs = new Jobs();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.ACAI_TRUST_PROXY === "1" ? 1 : false);
  // Webhook signatures are computed over the exact bytes received.
  app.use(express.json({ limit: "4mb", verify: (req, _res, buf) => void ((req as Request & { rawBody?: Buffer }).rawBody = buf) }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' vscode-webview:; base-uri 'none'; form-action 'self'",
    );
    // Without auth the server must only answer to local names (DNS-rebinding protection).
    // Webhooks carry their own signature, and the health check reveals nothing, so they are exempt.
    if (authMode() === "none" && !LOOPBACK.test(req.headers.host ?? "") && !req.path.startsWith("/hooks/") && req.path !== "/healthz") {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }
    next();
  });

  /** For container and load-balancer health checks: no sign-in, no details. */
  app.get("/healthz", (_req, res) => void res.set("Cache-Control", "no-store").json({ ok: true }));

  const bearerOf = (req: Request) => {
    const h = req.headers.authorization;
    return h?.startsWith("Bearer ") ? h.slice(7).trim() : undefined;
  };
  const signedIn = (account: Account, oauthClient?: string): Who => ({ actor: { type: "human", name: account.name }, account, role: account.role, oauthClient });

  /**
   * API tokens (Authorization: Bearer) work everywhere; dashboard sessions (cookie) on /api only;
   * OAuth access tokens on /mcp only. Without accounts, the local user names themselves.
   */
  const identify = (req: Request): Who | null => {
    if (authMode() === "none") return { actor: { type: "human", name: String(req.headers["x-acai-user"] || userInfo().username).slice(0, 80) }, account: null, role: "admin" };
    const bearer = bearerOf(req);
    if (bearer) {
      const account = auth.authenticate(bearer);
      if (account) return signedIn(account);
      const viaOAuth = oauth && req.baseUrl === "/mcp" ? oauth.lookup(bearer) : null;
      const owner = viaOAuth && auth.byTokenHash(viaOAuth.grant);
      return viaOAuth && owner ? signedIn(owner, viaOAuth.client) : null;
    }
    const session = req.baseUrl === "/api" ? cookie(req, SESSION_COOKIE) : undefined;
    const account = session ? auth.session(session) : null;
    return account ? signedIn(account) : null;
  };

  // Remote MCP clients that cannot send a static token (ChatGPT, Claude.ai connectors) sign in with
  // OAuth: the person approves once with their Acai API token. Needs the server's public HTTPS URL.
  const publicUrl = process.env.ACAI_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined;
  const oauth =
    publicUrl && authMode() === "tokens"
      ? new AcaiOAuth({
          file: join(acaiHome(), "oauth.json"),
          resource: new URL(`${publicUrl}/mcp`),
          signIn: (token, { ip, client }) => {
            if (limiter.blocked(ip)) return { error: TOO_MANY };
            const account = auth.authenticate(token);
            if (!account) {
              limiter.fail(ip);
              auth.log({ name: "unknown", ip }, "login.failed", `OAuth: ${client.slice(0, 60)}`);
              return { error: "That is not a valid Acai API token." };
            }
            if (account.role === "viewer") return { error: "Viewer accounts cannot connect agents. Ask an administrator for the member role." };
            auth.log({ name: account.name, ip }, "oauth.grant", client.slice(0, 80));
            return { name: account.name };
          },
          // A revoked or expired token, a disabled or deleted account, or the viewer role ends the grant.
          grantValid: (g) => {
            const account = auth.byTokenHash(g);
            return Boolean(account && account.role !== "viewer");
          },
        })
      : undefined;
  if (oauth) {
    app.use(
      mcpAuthRouter({
        provider: oauth,
        issuerUrl: new URL(publicUrl!),
        resourceServerUrl: new URL(`${publicUrl}/mcp`),
        resourceName: "Acai",
        // Connectors keep their registration for good; an expiring secret would break them silently.
        clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
      }),
    );
    app.post("/oauth/consent", express.urlencoded({ extended: false, limit: "16kb" }), (req, res) => oauth.consent(req, res));
  }
  app.use("/.well-known", (_req, res) => void res.status(404).json({ error: "Not found" }));

  // The dashboard exchanges an API token for a session cookie; only the session's hash is stored.
  app.post("/api/login", (req, res) => {
    if (authMode() === "none") return void res.json({ ok: true, account: null });
    const ip = req.ip;
    if (limiter.blocked(ip)) return void res.status(429).json({ error: TOO_MANY });
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const r = token ? auth.login(token, ip) : null;
    if (!r) {
      limiter.fail(ip);
      return void res.status(401).json({ error: "Invalid token" });
    }
    res.setHeader("Set-Cookie", [`${SESSION_COOKIE}=${r.session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${r.maxAgeSec}${req.secure ? "; Secure" : ""}`, CLEAR_LEGACY_COOKIE]);
    res.json({ ok: true, account: { id: r.account.id, name: r.account.name, role: r.account.role } });
  });
  app.post("/api/logout", (req, res) => {
    if (req.headers["x-acai-request"] !== "1") return void res.status(403).json({ error: "Missing X-Acai-Request header" });
    const session = cookie(req, SESSION_COOKIE);
    if (session) auth.logout(session, req.ip);
    res.setHeader("Set-Cookie", [`${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${req.secure ? "; Secure" : ""}`, CLEAR_LEGACY_COOKIE]);
    res.json({ ok: true });
  });

  /** Role limits, checked before any route: why this request is refused, or null. */
  const forbidden = (req: Request, role: Role): string | null => {
    if (req.baseUrl === "/mcp") return role === "viewer" ? "Viewer accounts cannot use MCP. Ask an administrator for the member role." : null;
    const path = req.path;
    if (path === "/admin" || path.startsWith("/admin/")) return role === "admin" ? null : "Only administrators can do this.";
    if (role !== "viewer" || path === "/account" || path.startsWith("/account/")) return null;
    if (/^\/projects\/[^/]+\/automation\/?$/.test(path)) return "Viewer accounts cannot see or change webhook settings.";
    return req.method === "GET" || req.method === "HEAD" ? null : "Your account can view but not change anything (viewer role).";
  };

  // Mutating API calls must carry a custom header: browsers cannot send it cross-site without CORS.
  app.use(["/api", "/mcp"], (req, res, next) => {
    const who = identify(req);
    if (!who) {
      if (oauth && req.baseUrl === "/mcp") res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${oauth.metadataUrl}"`);
      return void res.status(401).json({ error: "Authentication required" });
    }
    if (req.path !== "/" && req.baseUrl === "/api" && req.method !== "GET" && req.headers["x-acai-request"] !== "1")
      return void res.status(403).json({ error: "Missing X-Acai-Request header" });
    const denied = forbidden(req, who.role);
    if (denied) return void res.status(403).json({ error: denied });
    res.locals.actor = who.actor;
    res.locals.who = who;
    next();
  });

  const actorOf = (res: Response) => res.locals.actor as Actor;
  const whoOf = (res: Response) => res.locals.who as Who;
  const changedBy = (req: Request, res: Response): ChangedBy => ({ name: actorOf(res).name, ip: req.ip, userId: whoOf(res).account?.id ?? undefined });
  /**
   * Approved build/test commands run on this server, and the model decides where code is sent:
   * administrators may, and members named in ACAI_APPROVERS.
   */
  const assertApprover = (who: Who, what: string) => {
    const approvers = names(process.env.ACAI_APPROVERS);
    if (who.role === "admin" || (who.role === "member" && who.account && approvers.includes(who.account.name))) return;
    throw new AuthError(403, `Only administrators${approvers.length ? ` and ${approvers.join(", ")}` : ""} may ${what}.`);
  };
  const route =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
      } catch (e) {
        const err = e as Error;
        const status = err instanceof AuthError ? err.status : err instanceof ReviewError ? 409 : /not found|unknown/i.test(err.message) ? 404 : 400;
        if (!res.headersSent) res.status(status).json({ error: err.message });
        else next(e);
      }
    };

  const ws = (req: Request): Workspace => opts.projects.get(String(req.params.pid)).ws;
  /** Register a directory; shared servers only accept directories inside ACAI_PROJECT_ROOTS. */
  const addByPath = (path: string, name?: string) => {
    const roots = (process.env.ACAI_PROJECT_ROOTS ?? "").split(":").filter(Boolean).map((r) => resolve(r));
    if (authMode() !== "none" && !roots.length) throw new ReviewError("Adding projects by path is disabled on shared servers. Set ACAI_PROJECT_ROOTS to the directories that may hold projects.");
    const abs = resolve(path);
    if (roots.length && !roots.some((r) => abs === r || abs.startsWith(r + "/"))) throw new ReviewError(`Projects must be inside: ${roots.join(", ")}`);
    return opts.projects.add(abs, name);
  };
  /** MCP clients name a project by id or path; unknown paths follow the same rules as the dashboard. */
  const openProject = (idOrPath: string) => {
    const known = opts.projects.list().find((p) => p.id === idOrPath || p.root === resolve(idOrPath));
    return opts.projects.get(known?.id ?? addByPath(idOrPath).id).ws;
  };
  const needProvider = () => {
    if (!opts.provider)
      throw new ReviewError("No model is configured. Choose one on the Model page, or drive the audit from an AI agent such as Claude Code (Connect agents).");
    return opts.provider;
  };

  app.get("/api/meta", route((_req, res) => {
    const first = opts.projects.list()[0];
    const w = first ? opts.projects.get(first.id).ws : null;
    const account = whoOf(res).account;
    return {
      name: "Acai",
      version: VERSION,
      user: actorOf(res).name,
      auth: authMode(),
      account: account && { id: account.id, name: account.name, role: account.role },
      provider: opts.provider ? { id: opts.provider.id, model: opts.provider.model, destination: opts.provider.destination, webSearch: opts.provider.supportsWebSearch } : null,
      providerError: modelError ?? undefined,
      registry: w ? { frameworks: w.registry.frameworks.length, controls: w.registry.controls.size, presets: w.registry.presets.length, hash: w.registry.hash, errors: w.registryErrors } : null,
      cloneEnabled: process.env.ACAI_ALLOW_CLONE === "true",
    };
  }));

  // ----------------------------------------------------------------- account
  /** The signed-in account; local mode (no accounts) has none. */
  const ownAccount = (res: Response) => {
    const account = whoOf(res).account;
    if (!account) throw new AuthError(404, "This server runs without accounts (local mode).");
    return account;
  };
  app.get("/api/account", route((_req, res) => {
    const account = ownAccount(res);
    return { account: auth.userInfo(account.id), tokens: auth.listTokens(account.id) };
  }));
  app.post("/api/account/tokens", route((req, res) =>
    auth.createToken(ownAccount(res).id, { label: req.body?.label, expiresInDays: req.body?.expiresInDays }, changedBy(req, res)),
  ));
  app.delete("/api/account/tokens/:id", route((req, res) => {
    auth.revokeToken(String(req.params.id), changedBy(req, res), { userId: ownAccount(res).id });
    return { ok: true };
  }));

  // ------------------------------------------------------------------- admin
  // Role checks for /api/admin happen in the middleware above.
  app.get("/api/admin/users", route(() => auth.listUsers()));
  app.post("/api/admin/users", route((req, res) => auth.createUser({ name: req.body?.name, role: req.body?.role }, changedBy(req, res))));
  app.patch("/api/admin/users/:id", route((req, res) => {
    const { name, role, disabled } = (req.body ?? {}) as Record<string, unknown>;
    return auth.updateUser(String(req.params.id), { name, role, disabled }, changedBy(req, res));
  }));
  app.delete("/api/admin/users/:id", route((req, res) => {
    auth.deleteUser(String(req.params.id), changedBy(req, res));
    return { ok: true };
  }));
  app.post("/api/admin/users/:id/tokens", route((req, res) =>
    auth.createToken(String(req.params.id), { label: req.body?.label, expiresInDays: req.body?.expiresInDays }, changedBy(req, res)),
  ));
  /** Ends the person's dashboard sessions and the OAuth connectors they approved. */
  app.post("/api/admin/users/:id/signout", route((req, res) => {
    const id = auth.user(String(req.params.id)).id;
    auth.signOut(id, changedBy(req, res));
    oauth?.revokeGrants(auth.grantsOf(id));
    return { ok: true };
  }));
  app.get("/api/admin/tokens", route(() => auth.listTokens()));
  app.delete("/api/admin/tokens/:id", route((req, res) => {
    auth.revokeToken(String(req.params.id), changedBy(req, res));
    return { ok: true };
  }));
  app.get("/api/admin/events", route(() => auth.events()));
  app.get("/api/admin/server", route(() => {
    const admins = names(process.env.ACAI_ADMINS);
    return {
      version: VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
      authMode: authMode(),
      ...(publicUrl ? { publicUrl } : {}),
      oauth: Boolean(oauth),
      trustProxy: process.env.ACAI_TRUST_PROXY === "1",
      webhookSecret: Boolean(webhooks.secret),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      allowClone: process.env.ACAI_ALLOW_CLONE === "true",
      projectRoots: (process.env.ACAI_PROJECT_ROOTS ?? "").split(":").filter(Boolean),
      approvers: names(process.env.ACAI_APPROVERS),
      ...(admins.length ? { admins } : {}),
      dataDir: acaiHome(),
      provider: opts.provider ? { id: opts.provider.id, model: opts.provider.model } : null,
      projects: opts.projects.list().length,
    };
  }));

  // ---------------------------------------------------------------- projects
  app.get("/api/projects", route(() =>
    opts.projects.list().map((p) => {
      const w = opts.projects.get(p.id).ws;
      const latest = w.store.latestAudit();
      return { ...p, rulesDir: w.store.rulesDir(), classification: w.store.readProject()?.classification?.summary, latest: latest && { id: latest.id, createdAt: latest.createdAt, phase: latest.phase, summary: summarize(latest.findings) }, running: jobs.running(p.id)?.title };
    }),
  ));
  app.post("/api/projects", route((req) => {
    const { path, gitUrl, name } = req.body as { path?: string; gitUrl?: string; name?: string };
    if (gitUrl) return opts.projects.clone(gitUrl, name);
    if (!path) throw new Error("path or gitUrl is required");
    const roots = (process.env.ACAI_PROJECT_ROOTS ?? "").split(":").filter(Boolean).map((r) => resolve(r));
    if (authMode() !== "none" && !roots.length) throw new ReviewError("Adding projects by path is disabled on shared servers. Set ACAI_PROJECT_ROOTS to the directories that may hold projects.");
    const abs = resolve(path);
    if (roots.length && !roots.some((r) => abs === r || abs.startsWith(r + "/"))) throw new ReviewError(`Projects must be inside: ${roots.join(", ")}`);
    return opts.projects.add(abs, name);
  }));
  app.delete("/api/projects/:pid", route((req) => opts.projects.remove(String(req.params.pid))));

  // ----------------------------------------------------------------- profile
  app.get("/api/projects/:pid/profile", route((req) => ws(req).profileView()));
  app.post("/api/projects/:pid/scan", route((req, res) => ws(req).refreshProfile(actorOf(res))));
  app.post("/api/projects/:pid/preset", route((req, res) => ws(req).applyPreset(String(req.body.presetId), actorOf(res))));
  app.post("/api/projects/:pid/answers", route((req, res) => ws(req).setAnswers(req.body.values ?? {}, actorOf(res), { confirm: req.body.confirm ?? true })));
  app.post("/api/projects/:pid/answers/confirm", route((req, res) => ws(req).confirmAnswers(req.body.ids ?? "all", actorOf(res))));
  app.post("/api/projects/:pid/purpose", route((req, res) => ws(req).setPurpose(String(req.body.purpose ?? ""), actorOf(res))));
  app.get("/api/projects/:pid/scope", route((req) => ws(req).scopeView()));
  app.post("/api/projects/:pid/scope/:fid", route((req, res) => ws(req).setScopeOverride(String(req.params.fid), req.body.value ?? null, actorOf(res))));
  app.post("/api/projects/:pid/verify", route((req, res) => {
    if (req.body.approve) assertApprover(whoOf(res), "approve commands that run on this server");
    return ws(req).setVerify(req.body.commands ?? [], { approve: Boolean(req.body.approve), timeoutSec: req.body.timeoutSec }, actorOf(res));
  }));
  app.post("/api/projects/:pid/settings", route((req, res) => ws(req).setFixOptions(req.body ?? {}, actorOf(res))));
  app.get("/api/projects/:pid/journal", route((req) => ({ entries: ws(req).journal(Number(req.query.limit ?? 300)).reverse(), integrity: ws(req).store.verifyJournal() })));
  app.get("/api/projects/:pid/file", route((req) => {
    const w = ws(req);
    const { abs, rel } = confine(w.root, String(req.query.path ?? ""), w.store.dir);
    if (isSensitivePath(rel)) throw new Error("This file may contain credentials and is not shown.");
    const lines = readFileSync(abs, "utf8").split(/\r?\n/);
    const from = Math.max(1, Number(req.query.from ?? 1));
    const to = Math.min(lines.length, Number(req.query.to ?? from + 400));
    return { path: rel, from, to, total: lines.length, lines: lines.slice(from - 1, to).map(redactSecrets) };
  }));

  // ------------------------------------------------------------------- model
  // The model for Acai's own agents. Changing it changes where code excerpts are sent, so it
  // follows the same rule as approving commands (administrators and ACAI_APPROVERS) and can be locked.
  let modelError: string | null = opts.providerError ?? null;
  const modelLocked = () => process.env.ACAI_MODEL_LOCKED === "1";
  const modelState = () => {
    const { config, source } = resolveProviderConfig();
    const saved = modelLocked() ? null : readModelSettings();
    return {
      active: opts.provider && { preset: config.preset ?? opts.provider.id, model: opts.provider.model, destination: opts.provider.destination, webSearch: opts.provider.supportsWebSearch },
      source: opts.provider ? source : "none",
      error: modelError,
      locked: modelLocked(),
      inContainer: process.env.ACAI_CONTAINER === "1",
      saved: saved && { preset: saved.preset, model: saved.model, baseURL: saved.baseURL, effort: saved.effort, hasKey: Boolean(saved.apiKey) },
      presets: PROVIDER_PRESETS.map((p) => ({ ...p, baseURL: defaultBaseURL(p), keyInEnvironment: Boolean(p.keyEnv && process.env[p.keyEnv]) })),
    };
  };
  const modelInput = (body: Record<string, unknown>): ModelSettings => {
    const preset = presetById(String(body.preset ?? ""));
    if (!preset) throw new Error(`Unknown provider "${body.preset}"`);
    const baseURL = typeof body.baseURL === "string" && body.baseURL.trim() ? body.baseURL.trim() : undefined;
    if (baseURL && !/^https?:\/\/[^\s]+$/.test(baseURL)) throw new Error("The endpoint must be an http or https URL");
    const effort = ["low", "medium", "high", "xhigh", "max"].includes(String(body.effort)) ? (body.effort as ModelSettings["effort"]) : undefined;
    // An empty key keeps the saved one for the same provider (the dashboard never receives keys back).
    const prev = readModelSettings();
    const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : prev?.preset === preset.id ? prev.apiKey : undefined;
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim().slice(0, 200) : undefined;
    return { preset: preset.id, model, baseURL: baseURL && baseURL !== defaultBaseURL(preset) ? baseURL : undefined, apiKey, effort };
  };
  const canChangeModel = (res: Response) => {
    if (modelLocked()) throw new ReviewError("The model is set by the administrator (ACAI_MODEL_LOCKED=1).");
    assertApprover(whoOf(res), "change the model");
  };

  app.get("/api/model", route(() => modelState()));
  app.post("/api/model/models", route(async (req, res) => {
    canChangeModel(res);
    const s = modelInput(req.body ?? {});
    try {
      return { models: await listModels(configFromSettings(s)) };
    } catch (e) {
      throw new ReviewError(`Could not list the models: ${(e as Error).message.slice(0, 300)}`);
    }
  }));
  app.post("/api/model", route(async (req, res) => {
    canChangeModel(res);
    const s = modelInput(req.body ?? {});
    const next = await createProvider(configFromSettings(s)); // throws on a missing model or endpoint
    writeModelSettings(s);
    opts.provider = next;
    modelError = null;
    console.log(`[acai] model changed by ${actorOf(res).name}: ${next?.destination ?? "none"}`);
    return modelState();
  }));
  app.delete("/api/model", route(async (_req, res) => {
    canChangeModel(res);
    writeModelSettings(null);
    try {
      opts.provider = await createProvider(resolveProviderConfig().config);
      modelError = null;
    } catch (e) {
      opts.provider = null;
      modelError = (e as Error).message;
    }
    return modelState();
  }));

  // ------------------------------------------------------------------ audits
  app.get("/api/projects/:pid/audits", route((req) => ws(req).listAudits()));
  app.post("/api/projects/:pid/audits", route((req, res) => {
    const w = ws(req);
    const pid = String(req.params.pid);
    const mode = req.body.mode === "agent" ? "agent" : "static";
    if (mode === "agent") needProvider();
    const a = w.createAudit({ mode, actor: actorOf(res) });
    let jobId: string | undefined;
    if (mode === "agent") {
      const provider = needProvider();
      jobId = jobs.start({ kind: "investigate", projectId: pid, auditId: a.id, title: `Investigate ${a.id}` }, async ({ signal, emit }) => {
        if (req.body.understand !== false) await understandProduct(w, { provider, signal, onEvent: emit });
        return investigate(w, a.id, { provider, signal, onEvent: emit, batches: req.body.batches });
      }).id;
    }
    return { audit: a, jobId };
  }));
  app.get("/api/projects/:pid/audits/:aid", route((req) => {
    const w = ws(req);
    const a = w.getAudit(String(req.params.aid));
    return { ...a, findings: a.findings.map((f) => w.findingView(f)), summary: summarize(a.findings) };
  }));
  app.post("/api/projects/:pid/audits/:aid/findings", route((req, res) => ws(req).addFindings(String(req.params.aid), [req.body as FindingDraft], actorOf(res))));
  app.post("/api/projects/:pid/audits/:aid/findings/:fid/review", route(async (req, res) => {
    const w = ws(req);
    const pid = String(req.params.pid);
    const aid = String(req.params.aid);
    const fid = String(req.params.fid);
    const f = await w.review(aid, fid, req.body, actorOf(res));
    let jobId: string | undefined;
    if (req.body.action === "reinvestigate" && opts.provider && !jobs.running(pid)) {
      const provider = opts.provider;
      jobId = jobs.start({ kind: "reinvestigate", projectId: pid, auditId: aid, findingId: fid, title: `Re-investigate ${fid}` }, ({ signal, emit }) =>
        reinvestigate(w, aid, fid, { provider, signal, onEvent: emit }),
      ).id;
    }
    return { finding: w.findingView(f), jobId };
  }));
  app.post("/api/projects/:pid/audits/:aid/findings/:fid/reinvestigate", route((req) => {
    const w = ws(req);
    const provider = needProvider();
    const [pid, aid, fid] = [String(req.params.pid), String(req.params.aid), String(req.params.fid)];
    return jobs.start({ kind: "reinvestigate", projectId: pid, auditId: aid, findingId: fid, title: `Re-investigate ${fid}` }, ({ signal, emit }) =>
      reinvestigate(w, aid, fid, { provider, signal, onEvent: emit }),
    );
  }));
  app.post("/api/projects/:pid/audits/:aid/findings/:fid/fix", route((req) => {
    const w = ws(req);
    const provider = needProvider();
    const [pid, aid, fid] = [String(req.params.pid), String(req.params.aid), String(req.params.fid)];
    return jobs.start({ kind: "fix", projectId: pid, auditId: aid, findingId: fid, title: `Fix ${fid}` }, ({ signal, emit }) => fixFinding(w, aid, fid, { provider, signal, onEvent: emit }));
  }));
  app.post("/api/projects/:pid/audits/:aid/findings/:fid/abort-fix", route((req, res) => {
    const pid = String(req.params.pid);
    if (jobs.running(pid)?.findingId === String(req.params.fid)) throw new ReviewError("A fix job is running for this finding; cancel the job instead.");
    ws(req).abortFix(String(req.params.aid), String(req.params.fid), String(req.body.reason ?? "Abandoned by the reviewer."), actorOf(res));
  }));
  app.post("/api/projects/:pid/audits/:aid/fix-confirmed", route((req) => {
    const w = ws(req);
    const provider = needProvider();
    const [pid, aid] = [String(req.params.pid), String(req.params.aid)];
    const ids = w.getAudit(aid).findings.filter((f) => f.status === "confirmed" && f.fixability !== "process").map((f) => f.id);
    if (!ids.length) throw new ReviewError("No confirmed findings to fix.");
    return jobs.start({ kind: "fix-confirmed", projectId: pid, auditId: aid, title: `Fix ${ids.length} confirmed finding(s)` }, async ({ signal, emit }) => {
      const results: Record<string, string> = {};
      for (const id of ids) {
        if (signal.aborted) break;
        emit({ type: "notice", message: `Fixing ${id}`, stage: `fix:${id}` });
        try {
          results[id] = (await fixFinding(w, aid, id, { provider, signal, onEvent: emit })).status;
        } catch (e) {
          results[id] = `error: ${(e as Error).message}`;
        }
      }
      return results;
    });
  }));
  app.post("/api/projects/:pid/audits/:aid/controls/:cid", route((req, res) =>
    ws(req).assessControl(String(req.params.aid), String(req.params.cid), req.body.status, String(req.body.note ?? ""), actorOf(res)),
  ));
  /** The findings as tasks for a coding agent (Markdown brief, or JSON). */
  app.get("/api/projects/:pid/audits/:aid/tasks", route((req, res) => {
    const w = ws(req);
    const aid = String(req.params.aid);
    const statuses = String(req.query.status ?? "confirmed").split(",").filter(Boolean) as never;
    const ids = req.query.ids ? String(req.query.ids).split(",") : undefined;
    const tasks = fixTasks(w, aid, { statuses, ids });
    if (req.query.format === "json") return tasks;
    res.type("text/markdown; charset=utf-8").send(tasksMarkdown(w, tasks, { auditId: aid }));
  }));
  app.get("/api/projects/:pid/audits/:aid/report", route((req, res) => {
    const fmt = (["md", "json", "sarif"].includes(String(req.query.format)) ? req.query.format : "md") as "md" | "json" | "sarif";
    const body = report(ws(req), String(req.params.aid), fmt);
    res.setHeader("Content-Type", fmt === "md" ? "text/markdown; charset=utf-8" : "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.aid}.${fmt === "md" ? "md" : fmt === "sarif" ? "sarif" : "json"}"`);
    res.send(body);
  }));

  // ------------------------------------------------------- agent jobs, research
  app.post("/api/projects/:pid/understand", route((req) => {
    const w = ws(req);
    const provider = needProvider();
    return jobs.start({ kind: "understand", projectId: String(req.params.pid), title: "Understand the product" }, ({ signal, emit }) => understandProduct(w, { provider, signal, onEvent: emit }));
  }));
  app.post("/api/projects/:pid/verify/run", route((req) => {
    const w = ws(req);
    return jobs.start({ kind: "verify", projectId: String(req.params.pid), title: "Run build and tests" }, async ({ signal, emit }) => {
      const runs = await w.runVerify(signal);
      for (const r of runs) emit({ type: "notice", message: `${r.passed ? "PASS" : "FAIL"} ${r.command} (${r.durationMs} ms)` });
      return runs;
    });
  }));
  app.get("/api/projects/:pid/research", route((req) => ws(req).store.readResearch()));
  app.post("/api/projects/:pid/research/run", route((req) => {
    const w = ws(req);
    const provider = needProvider();
    return jobs.start({ kind: "research", projectId: String(req.params.pid), title: "Research guardrails" }, ({ signal, emit }) => research(w, { provider, signal, onEvent: emit }));
  }));
  app.post("/api/projects/:pid/research/:rid", route((req, res) => ws(req).decideRule(String(req.params.rid), req.body.decision, actorOf(res))));

  app.get("/api/jobs", route((req) => jobs.list(req.query.project ? String(req.query.project) : undefined)));
  app.get("/api/jobs/:id", route((req) => {
    const j = jobs.get(String(req.params.id));
    if (!j) throw new Error("Job not found");
    return j;
  }));
  app.post("/api/jobs/:id/cancel", route((req) => jobs.cancel(String(req.params.id))));

  // ---------------------------------------------------------------- registry
  app.get("/api/registry", route(() => {
    const first = opts.projects.list()[0];
    if (!first) return { frameworks: [], presets: [], checks: ALL_CHECKS, artifacts: ARTIFACTS, categories: CATEGORY_LABELS };
    const r = opts.projects.get(first.id).ws.registry;
    const template = join(r.root, "templates", "project-rule.yaml");
    return {
      hash: r.hash,
      root: r.root,
      ruleTemplate: existsSync(template) ? readFileSync(template, "utf8") : null,
      batches: BATCHES.map(({ id, title }) => ({ id, title })),
      frameworks: r.frameworks.map(({ controls, ...f }) => ({ ...f, controlCount: controls.length })),
      presets: r.presets,
      questionnaire: r.questionnaire,
      checks: ALL_CHECKS.map(({ id, title, description, severity, category, confidence }) => ({ id, title, description, severity, category, confidence })),
      artifacts: ARTIFACTS.map(({ id, title, draftPath, draftHint }) => ({ id, title, draftPath, draftHint })),
      categories: CATEGORY_LABELS,
    };
  }));
  /** Rule files changed on disk (registry/frameworks or a project's .acai/rules): load them without a restart. */
  app.post("/api/registry/reload", route(() => {
    opts.projects.reloadRegistries();
    return opts.projects.list().map((p) => {
      const w = opts.projects.get(p.id).ws;
      return { project: p.id, frameworks: w.registry.frameworks.length, controls: w.registry.controls.size, errors: w.registryErrors };
    });
  }));
  app.get("/api/registry/frameworks/:id", route((req) => {
    const first = opts.projects.list()[0];
    const f = first && opts.projects.get(first.id).ws.registry.frameworks.find((x) => x.id === req.params.id);
    if (!f) throw new Error("Framework not found");
    return f;
  }));

  // -------------------------------------------------------------------- live
  const watchers = new Map<string, FSWatcher[]>();
  app.get("/api/events", (req, res) => {
    const pid = req.query.project ? String(req.query.project) : undefined;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    send("hello", { at: new Date().toISOString() });
    const onJob = (e: { projectId: string }) => (!pid || e.projectId === pid) && send("job", e);
    jobs.events.on("job", onJob);
    let onStore: ((e: unknown) => void) | undefined;
    let w: Workspace | undefined;
    if (pid) {
      w = opts.projects.get(pid).ws;
      onStore = (e) => send("change", e);
      w.store.events.on("change", onStore);
      // Changes made by another process (an MCP server, the CLI) show up through the file system.
      if (!watchers.has(pid) && existsSync(w.store.dir)) {
        let timer: NodeJS.Timeout | undefined;
        const fire = () => {
          clearTimeout(timer);
          timer = setTimeout(() => w!.store.events.emit("change", { type: "external" }), 300);
        };
        const list = [w.store.dir, join(w.store.dir, "audits")].filter(existsSync).map((d) => watch(d, fire));
        watchers.set(pid, list);
      }
    }
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      jobs.events.off("job", onJob);
      if (w && onStore) w.store.events.off("change", onStore);
    });
  });

  // --------------------------------------------------------------------- MCP
  const dashboardUrl = () => publicUrl ?? `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${opts.port}`;
  app.post("/mcp", async (req, res) => {
    const list = opts.projects.list();
    const who = whoOf(res);
    const server = createMcpServer({
      projects: opts.projects,
      open: openProject,
      defaultProject: list.length === 1 ? list[0].id : undefined,
      dashboardUrl,
      clientName: who.oauthClient ? `${who.actor.name} via ${who.oauthClient.slice(0, 60)}` : who.account ? who.actor.name : "MCP client",
      canApprove: () => assertApprover(who, "approve commands that run on this server"),
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: (e as Error).message }, id: null });
    }
  });
  app.all("/mcp", (_req, res) => void res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));

  // ---------------------------------------------------------------- webhooks
  const webhooks = new Webhooks({
    projects: opts.projects,
    jobs,
    provider: () => opts.provider,
    publicUrl,
    clone: process.env.ACAI_ALLOW_CLONE === "true" ? (url, name) => opts.projects.clone(url, name).id : undefined,
  });
  app.post("/hooks/:provider", (req, res) => {
    const provider = String(req.params.provider);
    if (!["github", "gitlab", "generic"].includes(provider)) return void res.status(404).json({ error: "Use /hooks/github, /hooks/gitlab or /hooks/generic" });
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const r = webhooks.receive(provider as Provider, req.headers, raw);
    res.status(r.status).json(r.body);
  });
  app.get("/api/projects/:pid/automation", route((req) => {
    const w = ws(req);
    let origin: string | undefined;
    try {
      // Without any credentials a remote URL may carry (https://user:token@host/...).
      origin = execFileSync("git", ["-C", w.root, "config", "--get", "remote.origin.url"], { stdio: "pipe" }).toString().trim().replace(/^(\w+:\/\/)[^/@]*@/, "$1") || undefined;
    } catch {
      origin = undefined;
    }
    return {
      settings: w.automation(),
      publicUrl: publicUrl ?? null,
      secretSet: Boolean(webhooks.secret),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      model: Boolean(opts.provider),
      origin,
      branch: isGitRepo(w.root) ? currentBranch(w.root) : undefined,
      deliveries: webhooks.deliveries(String(req.params.pid)),
    };
  }));
  app.post("/api/projects/:pid/automation", route((req, res) => {
    // Automatic agent audits send code to the model on every push: same rule as changing the model.
    assertApprover(whoOf(res), "change automation settings");
    return ws(req).setAutomation(req.body ?? {}, actorOf(res));
  }));

  /** Setup for each MCP client, for the dashboard's "Connect agents" page (same text as `acai connect`). */
  app.get("/api/connect", route((req) => {
    const pid = req.query.project ? String(req.query.project) : opts.projects.list()[0]?.id;
    const project = pid ? opts.projects.get(pid).entry : undefined;
    const run = launcher();
    // Without a public URL, use the address the browser reached this server on.
    const seen = typeof req.query.url === "string" && /^https?:\/\/[\w.:[\]-]+(\/[\w./-]*)?\/mcp$/.test(req.query.url) ? req.query.url : undefined;
    const mcpUrl = publicUrl ? `${publicUrl}/mcp` : seen ?? `${dashboardUrl()}/mcp`;
    // ChatGPT, Claude.ai and the model APIs need a public URL with OAuth or a token they can send.
    const internetUrl = publicUrl && oauth ? mcpUrl : undefined;
    const root = project?.root ?? "/path/to/repo";
    // In a container the local (stdio) setup would point at paths inside the container.
    const container = process.env.ACAI_CONTAINER === "1";
    return {
      container,
      mcpUrl,
      publicUrl: publicUrl ?? null,
      auth: authMode(),
      oauth: Boolean(oauth),
      bundleBuilt: existsSync(run[1]),
      stdioCommand: [...run, "mcp", root, "--dashboard"],
      project: project && { id: project.id, name: project.name, root: project.root },
      clients: CLIENTS.map((c) => ({
        id: c,
        label: CLIENT_LABELS[c],
        remoteOnly: REMOTE_ONLY.has(c),
        local: REMOTE_ONLY.has(c) || container ? null : connectGuide(c, { project: root, launcher: run }),
        remote: connectGuide(c, { project: root, launcher: run, url: REMOTE_ONLY.has(c) ? internetUrl : mcpUrl }),
      })),
    };
  }));

  // --------------------------------------------------------------- dashboard
  const dir = findDashboardDir(opts.dashboardDir);
  if (dir) {
    app.use(express.static(dir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api|mcp|oauth|hooks).*/, (_req, res) => res.sendFile(join(dir, "index.html")));
  } else {
    app.get("/", (_req, res) => void res.type("text").send("Acai API is running. The dashboard is not built: run `npm run build`."));
  }

  return { app, jobs, webhooks, auth, authMode, oauth: Boolean(oauth) };
}

export type StartedServer = { server: Server; url: string; jobs: Jobs; webhooks: Webhooks; auth: AuthStore; authMode: "none" | "tokens"; oauth: boolean };

export async function startServer(opts: ServerOptions): Promise<StartedServer> {
  const loopback = /^(127\.0\.0\.1|localhost|::1)$/.test(opts.host);
  const { app, jobs, webhooks, auth, authMode, oauth } = createApp(opts);
  if (!loopback && authMode() === "none" && !opts.allowInsecure)
    throw new Error(
      `Refusing to listen on ${opts.host} without authentication. Create the first administrator: set ACAI_ADMIN_TOKEN to a random value of at least 16 characters (for example \`openssl rand -hex 32\`), or run \`acai users add <name> --role admin\`; or bind to 127.0.0.1.`,
    );
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      opts.port = port;
      resolvePromise({ server, url: `http://${loopback ? "127.0.0.1" : opts.host}:${port}`, jobs, webhooks, auth, authMode: authMode(), oauth });
    });
    server.on("error", reject);
  });
}
