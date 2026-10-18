import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import type { Server } from "node:http";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type Actor, ALL_CHECKS, ARTIFACTS, CATEGORY_LABELS, confine, type FindingDraft, fixFinding, investigate, isSensitivePath,
  type LlmProvider, redactSecrets, reinvestigate, report, research, ReviewError, summarize, understandProduct, type Workspace,
} from "@assay/core";
import express, { type NextFunction, type Request, type Response } from "express";
import { Jobs } from "./jobs";
import { createMcpServer } from "./mcp";
import type { Projects } from "./projects";

export type ServerOptions = {
  projects: Projects;
  provider: LlmProvider | null;
  host: string;
  port: number;
  dashboardDir?: string;
  allowInsecure?: boolean;
};

type Auth = { mode: "none" } | { mode: "shared"; token: string } | { mode: "users"; tokens: Map<string, string> };

function authConfig(): Auth {
  if (process.env.ASSAY_TOKENS) {
    const tokens = new Map<string, string>();
    for (const pair of process.env.ASSAY_TOKENS.split(",")) {
      const [name, token] = pair.split(":").map((x) => x.trim());
      if (name && token && token.length >= 16) tokens.set(token, name);
    }
    if (!tokens.size) throw new Error("ASSAY_TOKENS must be name:token pairs with tokens of at least 16 characters");
    return { mode: "users", tokens };
  }
  if (process.env.ASSAY_TOKEN) {
    if (process.env.ASSAY_TOKEN.length < 16) throw new Error("ASSAY_TOKEN must be at least 16 characters");
    return { mode: "shared", token: process.env.ASSAY_TOKEN };
  }
  return { mode: "none" };
}

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d+)?$/;

export function findDashboardDir(explicit?: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, process.env.ASSAY_DASHBOARD_DIR, join(here, "dashboard"), join(here, "../../dashboard/dist"), join(here, "../dashboard/dist")].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, "index.html")));
}

export function createApp(opts: ServerOptions) {
  const auth = authConfig();
  const jobs = new Jobs();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.ASSAY_TRUST_PROXY === "1" ? 1 : false);
  app.use(express.json({ limit: "4mb" }));

  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' vscode-webview:; base-uri 'none'; form-action 'self'",
    );
    // Without auth the server must only answer to local names (DNS-rebinding protection).
    if (auth.mode === "none" && !LOOPBACK.test(req.headers.host ?? "")) {
      res.status(403).json({ error: "Host not allowed" });
      return;
    }
    next();
  });

  const tokenOf = (req: Request) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) return h.slice(7).trim();
    const cookie = req.headers.cookie?.split(/;\s*/).find((c) => c.startsWith("assay_token="));
    return cookie ? decodeURIComponent(cookie.slice("assay_token=".length)) : undefined;
  };

  const identify = (req: Request): Actor | null => {
    if (auth.mode === "none") return { type: "human", name: String(req.headers["x-assay-user"] || userInfo().username).slice(0, 80) };
    const t = tokenOf(req);
    if (!t) return null;
    if (auth.mode === "shared") return safeEq(t, auth.token) ? { type: "human", name: String(req.headers["x-assay-user"] || "reviewer").slice(0, 80) } : null;
    for (const [token, name] of auth.tokens) if (safeEq(t, token)) return { type: "human", name };
    return null;
  };

  app.post("/api/login", (req, res) => {
    const token = String(req.body?.token ?? "");
    const fake = { ...req, headers: { ...req.headers, authorization: `Bearer ${token}` } } as Request;
    if (auth.mode !== "none" && !identify(fake)) return void res.status(401).json({ error: "Invalid token" });
    res.setHeader("Set-Cookie", `assay_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/${req.secure ? "; Secure" : ""}`);
    res.json({ ok: true });
  });

  // Mutating API calls must carry a custom header: browsers cannot send it cross-site without CORS.
  app.use(["/api", "/mcp"], (req, res, next) => {
    const actor = identify(req);
    if (!actor) return void res.status(401).json({ error: "Authentication required" });
    if (req.path !== "/" && req.baseUrl === "/api" && req.method !== "GET" && req.headers["x-assay-request"] !== "1")
      return void res.status(403).json({ error: "Missing X-Assay-Request header" });
    res.locals.actor = actor;
    next();
  });

  const actorOf = (res: Response) => res.locals.actor as Actor;
  /** Approving build/test commands lets them run on this server; ASSAY_APPROVERS limits who may. */
  const assertApprover = (actor: Actor) => {
    const approvers = (process.env.ASSAY_APPROVERS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (approvers.length && !approvers.includes(actor.name.replace(/ \(relaying the user\)$/, "")))
      throw new ReviewError(`Only ${approvers.join(", ")} may approve commands that run on this server.`);
  };
  const route =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const out = await fn(req, res);
        if (!res.headersSent) res.json(out ?? { ok: true });
      } catch (e) {
        const err = e as Error;
        const status = err instanceof ReviewError ? 409 : /not found|unknown/i.test(err.message) ? 404 : 400;
        if (!res.headersSent) res.status(status).json({ error: err.message });
        else next(e);
      }
    };

  const ws = (req: Request): Workspace => opts.projects.get(String(req.params.pid)).ws;
  const needProvider = () => {
    if (!opts.provider)
      throw new ReviewError("No model provider is configured. Set ANTHROPIC_API_KEY (or ASSAY_PROVIDER=openai-compatible with ASSAY_OPENAI_BASE_URL) and restart, or drive the audit from an MCP host such as Claude Code.");
    return opts.provider;
  };

  app.get("/api/meta", route((_req, res) => {
    const first = opts.projects.list()[0];
    const w = first ? opts.projects.get(first.id).ws : null;
    return {
      name: "Assay",
      version: "0.1.0",
      user: actorOf(res).name,
      auth: auth.mode,
      provider: opts.provider ? { id: opts.provider.id, model: opts.provider.model, destination: opts.provider.destination, webSearch: opts.provider.supportsWebSearch } : null,
      registry: w ? { frameworks: w.registry.frameworks.length, controls: w.registry.controls.size, presets: w.registry.presets.length, hash: w.registry.hash, errors: w.registryErrors } : null,
      cloneEnabled: process.env.ASSAY_ALLOW_CLONE === "true",
    };
  }));

  // ---------------------------------------------------------------- projects
  app.get("/api/projects", route(() =>
    opts.projects.list().map((p) => {
      const w = opts.projects.get(p.id).ws;
      const latest = w.store.latestAudit();
      return { ...p, classification: w.store.readProject()?.classification?.summary, latest: latest && { id: latest.id, createdAt: latest.createdAt, phase: latest.phase, summary: summarize(latest.findings) }, running: jobs.running(p.id)?.title };
    }),
  ));
  app.post("/api/projects", route((req) => {
    const { path, gitUrl, name } = req.body as { path?: string; gitUrl?: string; name?: string };
    if (gitUrl) return opts.projects.clone(gitUrl, name);
    if (!path) throw new Error("path or gitUrl is required");
    const roots = (process.env.ASSAY_PROJECT_ROOTS ?? "").split(":").filter(Boolean).map((r) => resolve(r));
    if (auth.mode !== "none" && !roots.length) throw new ReviewError("Adding projects by path is disabled on shared servers. Set ASSAY_PROJECT_ROOTS to the directories that may hold projects.");
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
    if (req.body.approve) assertApprover(actorOf(res));
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
    return {
      hash: r.hash,
      frameworks: r.frameworks.map(({ controls, ...f }) => ({ ...f, controlCount: controls.length })),
      presets: r.presets,
      questionnaire: r.questionnaire,
      checks: ALL_CHECKS.map(({ id, title, description, severity, category, confidence }) => ({ id, title, description, severity, category, confidence })),
      artifacts: ARTIFACTS.map(({ id, title, draftPath, draftHint }) => ({ id, title, draftPath, draftHint })),
      categories: CATEGORY_LABELS,
    };
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
  const dashboardUrl = () => `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${opts.port}`;
  app.post("/mcp", async (req, res) => {
    const list = opts.projects.list();
    const actor = actorOf(res);
    const server = createMcpServer({
      projects: opts.projects,
      defaultProject: list.length === 1 ? list[0].id : undefined,
      dashboardUrl,
      clientName: auth.mode === "users" ? actor.name : "MCP client",
      canApprove: () => assertApprover(actor),
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

  // --------------------------------------------------------------- dashboard
  const dir = findDashboardDir(opts.dashboardDir);
  if (dir) {
    app.use(express.static(dir, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api|mcp).*/, (_req, res) => res.sendFile(join(dir, "index.html")));
  } else {
    app.get("/", (_req, res) => void res.type("text").send("Assay API is running. The dashboard is not built: run `npm run build`."));
  }

  return { app, jobs };
}

export async function startServer(opts: ServerOptions): Promise<{ server: Server; url: string; jobs: Jobs }> {
  const auth = authConfig();
  const loopback = /^(127\.0\.0\.1|localhost|::1)$/.test(opts.host);
  if (!loopback && auth.mode === "none" && !opts.allowInsecure)
    throw new Error(`Refusing to listen on ${opts.host} without authentication. Set ASSAY_TOKEN or ASSAY_TOKENS (name:token,...), or bind to 127.0.0.1.`);
  const { app, jobs } = createApp(opts);
  return new Promise((resolvePromise, reject) => {
    const server = app.listen(opts.port, opts.host, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      opts.port = port;
      resolvePromise({ server, url: `http://${loopback ? "127.0.0.1" : opts.host}:${port}`, jobs });
    });
    server.on("error", reject);
  });
}
