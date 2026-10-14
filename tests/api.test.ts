import { beforeEach, afterEach, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createDb, type DB } from "../server/db.js";
import type { Config } from "../server/config.js";
import type { Mail, Providers } from "../server/providers.js";
import { hash, id } from "../server/security.js";
const origin = "http://localhost:5173";
const config: Config = {
  production: false,
  port: 4000,
  appUrl: origin,
  apiUrl: "http://localhost:4000",
  demo: true,
  memory: !process.env.TEST_DATABASE_URL,
  databaseUrl: process.env.TEST_DATABASE_URL,
  externalAi: false,
  regulatoryFetch: false,
};
let db: DB;
let app: ReturnType<typeof createApp>;
let mail: Mail[];
let sent: { phone: string; channel: string }[];
beforeEach(async () => {
  db = await createDb(config);
  if (process.env.TEST_DATABASE_URL)
    await db.query(
      "TRUNCATE source_checks,audit_log,api_keys,runs,rules,evidence,projects,auth_tokens,sessions,users CASCADE",
    );
  mail = [];
  sent = [];
  const p: Providers = {
    mail: async (m) => {
      mail.push(m);
    },
    otpSend: async (phone, channel) => {
      sent.push({ phone, channel });
    },
    otpCheck: async (_phone, code) => code === "123456",
  };
  app = createApp(db, config, p);
});
afterEach(async () => {
  await db.end();
});
const linkToken = () => mail.at(-1)!.text.match(/token=([\w-]+)/)![1];
const browser = () => request.agent(app);
async function account(email = `${id()}@example.com`) {
  const a = browser();
  await a
    .post("/api/auth/register")
    .set("Origin", origin)
    .send({ name: "Test Owner", email, password: "a strong test passphrase" })
    .expect(202);
  await a
    .post("/api/auth/verify")
    .set("Origin", origin)
    .send({ token: linkToken() })
    .expect(200);
  await a
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email, password: "a strong test passphrase" })
    .expect(200);
  return { a, email };
}
async function demo() {
  const a = browser();
  await a.post("/api/demo").set("Origin", origin).expect(200);
  const projects = await a.get("/api/projects").expect(200);
  return { a, pid: projects.body[0].id };
}
describe("identity boundaries", () => {
  it("opens an empty local workspace without preloading a sample project", async () => {
    const a = browser();
    await a
      .post("/api/demo")
      .set("Origin", origin)
      .send({ example: "empty" })
      .expect(200);
    expect((await a.get("/api/projects")).body).toEqual([]);
  });
  it("creates an isolated Memos example with no pre-approved evidence", async () => {
    const a = browser();
    await a
      .post("/api/demo")
      .set("Origin", origin)
      .send({ example: "memos" })
      .expect(200);
    const projects = await a.get("/api/projects").expect(200);
    expect(projects.body).toHaveLength(1);
    expect(projects.body[0].profile.name).toContain("Memos");
    const data = await a
      .get(`/api/projects/${projects.body[0].id}`)
      .expect(200);
    expect(data.body.evidence).toHaveLength(1);
    expect(data.body.evidence[0].status).toBe("submitted");
    expect(data.body.runs[0].score).toBe(0);
    expect(data.body.runs[0].findings).toHaveLength(9);
    const gate = await a
      .get(`/api/projects/${projects.body[0].id}/gate`)
      .expect(200);
    expect(gate.body.passed).toBe(false);
    expect(gate.body.blockers).toHaveLength(6);
  });
  it("does not consume the login attempt budget for session reads", async () => {
    const { a } = await demo();
    for (let i = 0; i < 45; i++) await a.get("/api/auth/me").expect(200);
    await a
      .post("/api/auth/forgot")
      .set("Origin", origin)
      .send({ email: "unregistered@example.com" })
      .expect(200);
    for (let i = 0; i < 39; i++) {
      await a
        .post("/api/auth/forgot")
        .set("Origin", origin)
        .send({ email: "unregistered@example.com" })
        .expect(200);
    }
    await a
      .post("/api/auth/forgot")
      .set("Origin", origin)
      .send({ email: "unregistered@example.com" })
      .expect(429);
  });
  it("requires email confirmation; consumes verification links once", async () => {
    const a = browser();
    await a
      .post("/api/auth/register")
      .set("Origin", origin)
      .send({
        name: "Alex Test",
        email: "alex@example.com",
        password: "strong test password",
      })
      .expect(202);
    expect(mail[0].subject).toContain("Confirm");
    const token = linkToken();
    await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "alex@example.com", password: "strong test password" })
      .expect(403);
    await a
      .post("/api/auth/verify")
      .set("Origin", origin)
      .send({ token })
      .expect(200);
    await a
      .post("/api/auth/verify")
      .set("Origin", origin)
      .send({ token })
      .expect(400);
    const login = await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "alex@example.com", password: "strong test password" })
      .expect(200);
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(login.body.user.password_hash).toBeUndefined();
    const stored = (await db.query("SELECT password_hash FROM users")).rows[0]
      .password_hash;
    expect(stored).not.toContain("strong test password");
    await a.get("/api/auth/me").expect(200);
  });
  it("resets passwords once, revokes old sessions and rejects old passwords", async () => {
    const { a, email } = await account();
    await a
      .post("/api/auth/forgot")
      .set("Origin", origin)
      .send({ email })
      .expect(200);
    const token = linkToken();
    await a
      .post("/api/auth/reset")
      .set("Origin", origin)
      .send({ token, password: "new secure passphrase" })
      .expect(200);
    await a.get("/api/auth/me").expect(401);
    await a
      .post("/api/auth/reset")
      .set("Origin", origin)
      .send({ token, password: "new secure passphrase" })
      .expect(400);
    await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password: "a strong test passphrase" })
      .expect(401);
    await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password: "new secure passphrase" })
      .expect(200);
  });
  it("rejects expired links", async () => {
    const { a, email } = await account();
    await a.post("/api/auth/forgot").set("Origin", origin).send({ email });
    const token = linkToken();
    await db.query("UPDATE auth_tokens SET expires_at=$1 WHERE token_hash=$2", [
      new Date(0),
      hash(token),
    ]);
    await a
      .post("/api/auth/reset")
      .set("Origin", origin)
      .send({ token, password: "new secure passphrase" })
      .expect(400);
  });
  it("does not establish a full session until the enrolled phone is verified", async () => {
    const { a, email } = await account();
    const enroll = await a
      .post("/api/auth/mfa/enroll")
      .set("Origin", origin)
      .send({
        phone: "+40712345678",
        channel: "whatsapp",
        password: "a strong test passphrase",
      })
      .expect(200);
    expect(sent[0].channel).toBe("whatsapp");
    await a
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({ challenge: enroll.body.challenge, code: "000000" })
      .expect(400);
    await a
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({ challenge: enroll.body.challenge, code: "123456" })
      .expect(200);
    await a.post("/api/auth/logout").set("Origin", origin).expect(200);
    const login = await a
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password: "a strong test passphrase" })
      .expect(200);
    expect(login.body.needsMfa).toBe(true);
    await a.get("/api/projects").expect(401);
    await a
      .post("/api/auth/mfa/send")
      .set("Origin", origin)
      .send({ challenge: login.body.challenge, channel: "sms" })
      .expect(200);
    await a
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({ challenge: login.body.challenge, code: "123456" })
      .expect(200);
    await a.get("/api/projects").expect(200);
    await a
      .post("/api/auth/mfa/verify")
      .set("Origin", origin)
      .send({ challenge: login.body.challenge, code: "123456" })
      .expect(400);
  });
  it("rejects untrusted origins, missing origins, untrusted hosts and anonymous requests", async () => {
    await request(app)
      .post("/api/demo")
      .set("Origin", "https://evil.example")
      .expect(403);
    await request(app).post("/api/demo").expect(403);
    await request(app)
      .get("/api/health")
      .set("Host", "evil.example")
      .expect(403);
    await request(app).get("/api/projects").expect(401);
  });
  it("does not bypass Google verification when credentials are missing", async () => {
    await request(app)
      .get("/api/auth/google/callback?state=abcdefghijklmnopqrst&code=fake")
      .expect(400);
  });
});

describe("code-connected projects", () => {
  const snapshot = {
    filesInspected: 4,
    technologyHints: ["react", "openai"],
    generatedAt: "2026-10-14T08:00:00.000Z",
    truncated: false,
    artifacts: {
      privacy: [],
      security: [],
      licenses: ["LICENSE"],
      tests: ["app.test.ts"],
      pipelines: [],
      mobile: [],
      embedded: [],
    },
  };
  it("imports code, adapts questions, saves answers and preserves earlier runs when rechecking", async () => {
    const { a, pid } = await demo();
    await a
      .put(`/api/projects/${pid}/connection`)
      .set("Origin", origin)
      .send({
        provider: "github",
        repository: "https://github.com/team/project",
      })
      .expect(200);
    const imported = await a
      .post(`/api/projects/${pid}/snapshot`)
      .set("Origin", origin)
      .send({ ...snapshot, secret: "MUST_BE_STRIPPED" })
      .expect(201);
    expect(imported.body.unanswered).toEqual(
      expect.arrayContaining(["ai", "privacy_notice"]),
    );
    expect(JSON.stringify(imported.body)).not.toContain("MUST_BE_STRIPPED");
    const first = await a
      .post(`/api/projects/${pid}/assess`)
      .set("Origin", origin)
      .expect(201);
    expect(first.body.findings.some((f: any) => f.id === "question:ai")).toBe(
      true,
    );
    expect(imported.body).not.toHaveProperty("project");
    expect(imported.body).not.toHaveProperty("connection");
    const answers = Object.fromEntries(
      imported.body.unanswered.map((qid: string) => [
        qid,
        "Owner confirmed the declared profile; implementation needs review.",
      ]),
    );
    const saved = await a
      .put(`/api/projects/${pid}/answers`)
      .set("Origin", origin)
      .send(answers)
      .expect(200);
    expect(saved.body.unanswered).toEqual([]);
    expect((await a.get(`/api/projects/${pid}/gate`)).body.reason).toContain(
      "Inputs changed",
    );
    const second = await a
      .post(`/api/projects/${pid}/assess`)
      .set("Origin", origin)
      .expect(201);
    expect(
      second.body.findings.some((f: any) => f.id.startsWith("question:")),
    ).toBe(false);
    const detail = (await a.get(`/api/projects/${pid}`)).body;
    expect(detail.runs.map((r: any) => r.id)).toEqual(
      expect.arrayContaining([first.body.id, second.body.id]),
    );
    expect(
      detail.evidence.filter((e: any) => e.status === "approved"),
    ).toHaveLength(4);
    await a
      .post(`/api/projects/${pid}/snapshot`)
      .set("Origin", origin)
      .send({ ...snapshot, revision: "abc1234" })
      .expect(201);
    expect((await a.get(`/api/projects/${pid}/gate`)).body.reason).toContain(
      "Inputs changed",
    );
    await a
      .put(`/api/projects/${pid}/connection`)
      .set("Origin", origin)
      .send({
        provider: "bitbucket",
        repository: "https://bitbucket.org/team/other",
      })
      .expect(200);
    const changed = (await a.get(`/api/projects/${pid}/discovery`)).body;
    expect(changed.connection.snapshot).toBeUndefined();
    expect(changed.connection.answers).toEqual({});
  });
  it("enforces ownership, scopes and bounded inputs on discovery endpoints", async () => {
    const { a, pid } = await demo(),
      other = await demo();
    await other.a.get(`/api/projects/${pid}/discovery`).expect(404);
    await other.a
      .post(`/api/projects/${pid}/snapshot`)
      .set("Origin", origin)
      .send(snapshot)
      .expect(404);
    await a
      .put(`/api/projects/${pid}/connection`)
      .set("Origin", origin)
      .send({
        provider: "github",
        repository: "https://token@github.com/team/repo",
      })
      .expect(400);
    await a
      .put(`/api/projects/${pid}/connection`)
      .set("Origin", origin)
      .send({
        provider: "github",
        repository: "https://github.com.evil.test/team/repo",
      })
      .expect(400);
    await a
      .post(`/api/projects/${pid}/snapshot`)
      .set("Origin", origin)
      .send({ ...snapshot, filesInspected: 5001 })
      .expect(400);
    await a
      .post(`/api/projects/${pid}/snapshot`)
      .set("Origin", origin)
      .send(snapshot)
      .expect(201);
    await a
      .put(`/api/projects/${pid}/answers`)
      .set("Origin", origin)
      .send({ invented: "No such question" })
      .expect(400);
    const key = (
      await a
        .post("/api/keys")
        .set("Origin", origin)
        .send({ name: "Read only", scopes: ["read"] })
    ).body.key;
    await request(app)
      .post(`/api/projects/${pid}/snapshot`)
      .set("Authorization", `Bearer ${key}`)
      .send(snapshot)
      .expect(403);
    await request(app)
      .put(`/api/projects/${pid}/answers`)
      .set("Authorization", `Bearer ${key}`)
      .send({ purpose: "An answer" })
      .expect(403);
  });
  it("lets an MCP agent import metadata, read and answer questions without approving evidence", async () => {
    const { a, pid } = await demo();
    const key = (
      await a
        .post("/api/keys")
        .set("Origin", origin)
        .send({ name: "Project agent", scopes: ["read", "assess", "evidence"] })
    ).body.key;
    const call = async (name: string, args: object) => {
      const response = await request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${key}`)
        .set("Accept", "application/json, text/event-stream")
        .send({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        })
        .expect(200);
      expect(response.body.result.isError).not.toBe(true);
      return JSON.parse(response.body.result.content[0].text);
    };
    await call("submit_code_snapshot", { projectId: pid, snapshot });
    const state = await call("get_project_questions", { projectId: pid });
    expect(state.unanswered).toContain("ai");
    await call("answer_project_questions", {
      projectId: pid,
      answers: {
        ai: "Optional OpenAI feature found in package.json; ask owner if deployed.",
      },
    });
    expect(
      (await call("get_project_questions", { projectId: pid })).connection
        .answers.ai,
    ).toContain("package.json");
    const run = await call("run_assessment", { projectId: pid });
    expect(run.findings.some((f: any) => f.id === "question:ai")).toBe(false);
    expect(run.findings.some((f: any) => f.id === "question:purpose")).toBe(
      true,
    );
    expect((await call("check_release_gate", { projectId: pid })).passed).toBe(
      false,
    );
    await request(app)
      .put(`/api/projects/${pid}/connection`)
      .set("Authorization", `Bearer ${key}`)
      .send({ provider: "local" })
      .expect(403);
  });
});
describe("ownership, assessment and release gates", () => {
  it("isolates projects, evidence, keys and reports by owner", async () => {
    const one = await demo();
    const two = await demo();
    await two.a.get(`/api/projects/${one.pid}`).expect(404);
    await two.a
      .post(`/api/projects/${one.pid}/assess`)
      .set("Origin", origin)
      .expect(404);
    await two.a
      .post(`/api/projects/${one.pid}/evidence`)
      .set("Origin", origin)
      .send({
        controlId: "privacy-notice",
        title: "Evidence",
        content: "Cross-account evidence attempt",
      })
      .expect(404);
    const mine = await two.a.get("/api/projects").expect(200);
    expect(mine.body).toHaveLength(1);
  });
  it("requires human review, recomputes coverage and blocks stale inputs", async () => {
    const { a, pid } = await demo();
    let gate = await a.get(`/api/projects/${pid}/gate`).expect(200);
    expect(gate.body.passed).toBe(false);
    const detail = await a.get(`/api/projects/${pid}`).expect(200);
    const findings = detail.body.runs[0].findings;
    for (const f of findings.filter(
      (f: any) => f.severity === "high" && f.status !== "covered",
    )) {
      const e = await a
        .post(`/api/projects/${pid}/evidence`)
        .set("Origin", origin)
        .send({
          controlId: f.id,
          title: "Reviewed procedure",
          content: "Documented review record supporting this control.",
        })
        .expect(201);
      await a
        .patch(`/api/projects/${pid}/evidence/${e.body.id}`)
        .set("Origin", origin)
        .send({ status: "approved" })
        .expect(200);
    }
    gate = await a.get(`/api/projects/${pid}/gate`);
    expect(gate.body.passed).toBe(false);
    expect(gate.body.reason).toContain("Inputs changed");
    const run = await a
      .post(`/api/projects/${pid}/assess`)
      .set("Origin", origin)
      .expect(201);
    expect(run.body.events).toHaveLength(5);
    gate = await a.get(`/api/projects/${pid}/gate`);
    expect(gate.body.passed).toBe(true);
    await db.query("UPDATE runs SET created_at=$1 WHERE project_id=$2", [
      new Date(0),
      pid,
    ]);
    gate = await a.get(`/api/projects/${pid}/gate`);
    expect(gate.body.passed).toBe(false);
    expect(gate.body.reason).toContain("seven days");
  });
  it("includes custom rules and invalidates the previous release gate", async () => {
    const { a, pid } = await demo();
    const r = await a
      .post(`/api/projects/${pid}/rules`)
      .set("Origin", origin)
      .send({
        title: "Encryption policy",
        description: "Every data store must have an encryption review.",
        severity: "high",
      })
      .expect(201);
    const run = await a
      .post(`/api/projects/${pid}/assess`)
      .set("Origin", origin)
      .expect(201);
    expect(
      run.body.findings.find((f: any) => f.id === r.body.id),
    ).toMatchObject({ framework: "Custom policy", status: "missing" });
    await a
      .delete(`/api/projects/${pid}/rules/${r.body.id}`)
      .set("Origin", origin)
      .expect(200);
    const gate = await a.get(`/api/projects/${pid}/gate`);
    expect(gate.body.reason).toContain("Inputs changed");
  });
  it("does not fetch sources unless egress is explicitly enabled", async () => {
    const { a } = await demo();
    await a.post("/api/sources/refresh").set("Origin", origin).expect(503);
  });
  it("validates profile and rejects oversized requests", async () => {
    const { a } = await demo();
    await a
      .post("/api/projects")
      .set("Origin", origin)
      .send({ name: "bad" })
      .expect(400);
    await a
      .post("/api/projects")
      .set("Origin", origin)
      .send({ description: "x".repeat(600000) })
      .expect(413);
  });
});
describe("MCP and key scopes", () => {
  it("returns key material only once and enforces scopes and revocation", async () => {
    const { a, pid } = await demo();
    const key = await a
      .post("/api/keys")
      .set("Origin", origin)
      .send({ name: "Read only", scopes: ["read"] })
      .expect(201);
    const raw = key.body.key;
    const listed = await a.get("/api/keys").expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(raw);
    await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${raw}`)
      .expect(200);
    await request(app)
      .post(`/api/projects/${pid}/assess`)
      .set("Authorization", `Bearer ${raw}`)
      .expect(403);
    await request(app)
      .post("/api/keys")
      .set("Authorization", `Bearer ${raw}`)
      .send({ name: "Escalation", scopes: ["evidence"] })
      .expect(403);
    await a
      .delete(`/api/keys/${key.body.id}`)
      .set("Origin", origin)
      .expect(200);
    await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${raw}`)
      .expect(401);
  });
  it("supports actual MCP initialization, discovery, resources and tools", async () => {
    const { a, pid } = await demo();
    const k = await a
      .post("/api/keys")
      .set("Origin", origin)
      .send({ name: "Agent", scopes: ["read", "assess", "evidence"] })
      .expect(201);
    const call = (method: string, params: object = {}) =>
      request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${k.body.key}`)
        .set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id: 1, method, params });
    const init = await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "tests", version: "1" },
    }).expect(200);
    expect(init.body.result.serverInfo.name).toBe("clearance");
    const listed = await call("tools/list").expect(200);
    expect(listed.body.result.tools).toHaveLength(9);
    const tool = await call("tools/call", {
      name: "get_assessment",
      arguments: { projectId: pid },
    }).expect(200);
    expect(JSON.parse(tool.body.result.content[0].text).project_id).toBe(pid);
    const resource = await call("resources/read", {
      uri: "clearance://skills/assessment",
    }).expect(200);
    expect(resource.body.result.contents[0].text).toContain("Human review");
    const bad = await call("tools/call", {
      name: "get_assessment",
      arguments: { projectId: "someone-elses-project" },
    }).expect(200);
    expect(bad.body.result.isError).toBe(true);
    await a.post("/mcp").set("Origin", origin).send({}).expect(401);
  });
  it("hides mutating tools from read-only MCP clients", async () => {
    const { a } = await demo();
    const k = await a
      .post("/api/keys")
      .set("Origin", origin)
      .send({ name: "Reader", scopes: ["read"] });
    const r = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${k.body.key}`)
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
      .expect(200);
    expect(r.body.result.tools.map((t: any) => t.name)).toEqual([
      "get_code_analysis",
      "get_project_questions",
      "list_projects",
      "get_assessment",
      "check_release_gate",
    ]);
  });
});
