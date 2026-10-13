import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { z, ZodError } from "zod";
import { resolve } from "node:path";
import type { DB } from "./db.js";
import type { Config } from "./config.js";
import { providers, type Providers } from "./providers.js";
import { authRouter, authServices } from "./auth.js";
import { profileSchema, evidenceSchema, ruleSchema } from "./validation.js";
import { id, token, hash, audit, HttpError } from "./security.js";
import {
  ownedProject,
  runAssessment,
  refreshSources,
  releaseGate,
} from "./engine.js";
import { controls, sources } from "./catalog.js";
import { seedDemo } from "./seed.js";
import { mcpHandler } from "./mcp.js";
export function createApp(
  db: DB,
  config: Config,
  provider: Providers = providers(),
) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "512kb" }), cookieParser());
  const origins = new Set([
    new URL(config.appUrl).origin,
    new URL(config.apiUrl).origin,
  ]);
  const hosts = new Set([
    new URL(config.appUrl).hostname,
    new URL(config.apiUrl).hostname,
  ]);
  if (!config.production) {
    origins.add("http://127.0.0.1:5173");
    hosts.add("127.0.0.1");
  }
  app.use((req, res, next) => {
    if (!hosts.has(req.hostname))
      return next(new HttpError(403, "Unrecognized host."));
    if (req.path.startsWith("/api") || req.path === "/mcp")
      res.setHeader("Cache-Control", "no-store");
    if (req.headers.origin && !origins.has(req.headers.origin))
      return next(new HttpError(403, "Origin is not allowed."));
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.headers.authorization &&
      !req.headers.origin
    )
      return next(
        new HttpError(403, "An Origin header is required for browser actions."),
      );
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Rate limit reached. Try again shortly." },
    }),
  );
  const auth = authServices(db, config);
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({
      status: "ok",
      database: config.memory ? "ephemeral-demo" : "postgresql",
    });
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      demo: config.demo,
      google:
        !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      email: !!process.env.BREVO_API_KEY && !!process.env.MAIL_FROM,
      otp:
        !!process.env.TWILIO_VERIFY_SERVICE_SID &&
        !!process.env.TWILIO_ACCOUNT_SID &&
        !!process.env.TWILIO_AUTH_TOKEN,
      externalAi: config.externalAi && !!process.env.OPENAI_API_KEY,
      regulatoryFetch: config.regulatoryFetch,
    }),
  );
  app.use("/api/auth", authRouter(db, config, provider, auth));
  app.post(
    "/api/demo",
    rateLimit({
      windowMs: 3600000,
      limit: 20,
      legacyHeaders: false,
      standardHeaders: "draft-8",
    }),
    async (_req, res) => {
      if (!config.demo) throw new HttpError(404, "Not found.");
      const uid = await seedDemo(db, config);
      await auth.issue(uid, res);
      res.json({ ok: true });
    },
  );
  const api = express.Router();
  api.use(auth.requireAuth);
  api.get("/projects", auth.scope("read"), async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM projects WHERE owner_id=$1 ORDER BY created_at DESC",
          [req.userId],
        )
      ).rows,
    ),
  );
  api.post("/projects", auth.browserOnly, async (req, res) => {
    const profile = profileSchema.parse(req.body);
    const pid = id();
    await db.query(
      "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
      [pid, req.userId, JSON.stringify(profile)],
    );
    await audit(db, req.userId!, "project.created", pid);
    res.status(201).json({ id: pid, profile });
  });
  api.put("/projects/:id", auth.browserOnly, async (req, res) => {
    await ownedProject(db, req.userId!, String(req.params.id));
    const profile = profileSchema.parse(req.body);
    await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
      JSON.stringify(profile),
      req.params.id,
    ]);
    await audit(db, req.userId!, "project.updated", String(req.params.id));
    res.json({ ok: true });
  });
  api.get("/projects/:id", auth.scope("read"), async (req, res) => {
    const project = await ownedProject(db, req.userId!, String(req.params.id));
    const [evidence, rules, runs] = await Promise.all([
      db.query(
        "SELECT * FROM evidence WHERE project_id=$1 ORDER BY created_at DESC",
        [project.id],
      ),
      db.query(
        "SELECT * FROM rules WHERE project_id=$1 ORDER BY created_at DESC",
        [project.id],
      ),
      db.query(
        "SELECT * FROM runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 30",
        [project.id],
      ),
    ]);
    res.json({
      project,
      evidence: evidence.rows,
      rules: rules.rows,
      runs: runs.rows,
      controls: controls
        .filter((c) => c.applies(project.profile))
        .map(({ applies, ...c }) => c),
    });
  });
  api.post(
    "/projects/:id/assess",
    auth.scope("assess"),
    rateLimit({ windowMs: 60000, limit: 10 }),
    async (req, res) =>
      res
        .status(201)
        .json(
          await runAssessment(db, config, req.userId!, String(req.params.id)),
        ),
  );
  api.get("/projects/:id/gate", auth.scope("read"), async (req, res) =>
    res.json(await releaseGate(db, req.userId!, String(req.params.id))),
  );
  api.post(
    "/projects/:id/evidence",
    auth.scope("evidence"),
    async (req, res) => {
      await ownedProject(db, req.userId!, String(req.params.id));
      const data = evidenceSchema.parse(req.body),
        eid = id();
      await db.query(
        "INSERT INTO evidence (id,project_id,control_id,title,content) VALUES ($1,$2,$3,$4,$5)",
        [eid, req.params.id, data.controlId, data.title, data.content],
      );
      await audit(db, req.userId!, "evidence.submitted", eid);
      res.status(201).json({ id: eid });
    },
  );
  api.patch(
    "/projects/:id/evidence/:evidenceId",
    auth.browserOnly,
    async (req, res) => {
      await ownedProject(db, req.userId!, String(req.params.id));
      const status = z
        .enum(["approved", "rejected", "submitted"])
        .parse(req.body.status);
      const changed = await db.query(
        "UPDATE evidence SET status=$1 WHERE id=$2 AND project_id=$3 RETURNING id",
        [status, req.params.evidenceId, req.params.id],
      );
      if (!changed.rows[0]) throw new HttpError(404, "Evidence not found.");
      await audit(
        db,
        req.userId!,
        `evidence.${status}`,
        String(req.params.evidenceId),
      );
      res.json({ ok: true });
    },
  );
  api.post("/projects/:id/rules", auth.browserOnly, async (req, res) => {
    await ownedProject(db, req.userId!, String(req.params.id));
    const data = ruleSchema.parse(req.body),
      rid = id();
    await db.query(
      "INSERT INTO rules (id,project_id,title,description,severity) VALUES ($1,$2,$3,$4,$5)",
      [rid, req.params.id, data.title, data.description, data.severity],
    );
    await audit(db, req.userId!, "rule.created", rid);
    res.status(201).json({ id: rid });
  });
  api.delete(
    "/projects/:id/rules/:ruleId",
    auth.browserOnly,
    async (req, res) => {
      await ownedProject(db, req.userId!, String(req.params.id));
      const result = await db.query(
        "DELETE FROM rules WHERE id=$1 AND project_id=$2 RETURNING id",
        [req.params.ruleId, req.params.id],
      );
      if (!result.rows[0]) throw new HttpError(404, "Rule not found.");
      await audit(db, req.userId!, "rule.deleted", String(req.params.ruleId));
      res.json({ ok: true });
    },
  );
  api.get("/sources", auth.scope("read"), async (req, res) =>
    res.json({
      sources,
      checks: (
        await db.query(
          "SELECT * FROM source_checks WHERE user_id=$1 ORDER BY checked_at DESC LIMIT 80",
          [req.userId],
        )
      ).rows,
    }),
  );
  api.post(
    "/sources/refresh",
    auth.browserOnly,
    rateLimit({ windowMs: 3600000, limit: 5 }),
    async (req, res) => res.json(await refreshSources(db, config, req.userId!)),
  );
  api.get("/keys", auth.browserOnly, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,name,prefix,scopes,expires_at,created_at FROM api_keys WHERE user_id=$1 ORDER BY created_at DESC",
          [req.userId],
        )
      ).rows,
    ),
  );
  api.post("/keys", auth.browserOnly, async (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        scopes: z
          .array(z.enum(["read", "assess", "evidence"]))
          .min(1)
          .max(3),
      })
      .parse(req.body);
    const raw = `clr_${token()}`,
      kid = id();
    await db.query(
      "INSERT INTO api_keys (id,user_id,name,token_hash,prefix,scopes,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        kid,
        req.userId,
        data.name,
        hash(raw),
        raw.slice(0, 10),
        JSON.stringify(data.scopes),
        new Date(Date.now() + 90 * 86400000),
      ],
    );
    await audit(db, req.userId!, "key.created", kid);
    res.status(201).json({ id: kid, key: raw });
  });
  api.delete("/keys/:id", auth.browserOnly, async (req, res) => {
    await db.query("DELETE FROM api_keys WHERE id=$1 AND user_id=$2", [
      req.params.id,
      req.userId,
    ]);
    await audit(db, req.userId!, "key.revoked", String(req.params.id));
    res.json({ ok: true });
  });
  api.get("/audit", auth.browserOnly, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
          [req.userId],
        )
      ).rows,
    ),
  );
  app.use("/api", api);
  app.post(
    "/mcp",
    rateLimit({ windowMs: 60000, limit: 60 }),
    auth.requireAuth,
    (req, _res, next) => {
      if (!req.scopes)
        return next(
          new HttpError(401, "MCP requires a scoped bearer API key."),
        );
      next();
    },
    mcpHandler(db, config),
  );
  app.all("/mcp", (_req, res) =>
    res
      .status(405)
      .set("Allow", "POST")
      .json({ error: "Use stateless Streamable HTTP POST." }),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  if (config.production) {
    app.use(express.static(resolve("dist/public")));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve("dist/public/index.html")),
    );
  }
  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) return;
      if (error instanceof ZodError)
        return res.status(400).json({
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      if (error instanceof HttpError)
        return res.status(error.status).json({ error: error.message });
      if (error.type === "entity.too.large")
        return res.status(413).json({ error: "Request is too large." });
      if (error instanceof SyntaxError)
        return res.status(400).json({ error: "Invalid JSON." });
      console.error("Request failed:", error.name || "Error");
      res.status(500).json({
        error: "The request could not be completed. Please try again.",
      });
    },
  );
  return app;
}
