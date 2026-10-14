import { beforeEach, afterEach, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createDb, type DB } from "../server/db.js";
import { id } from "../server/security.js";
import type { Config } from "../server/config.js";
import {
  analyzeSource,
  eligibleSource,
  redactSecrets,
} from "../shared/code-analysis.js";
import { repositoryRequest } from "../server/repository.js";
import { latestScan, startScan } from "../server/scans.js";
import { draftRuleSet, applyRuleSet } from "../server/rule-sets.js";
import { chat, chatHistory } from "../server/assistant.js";
import { enrichAnalysis } from "../server/ai.js";
import { sources } from "../server/catalog.js";
const { create, parse } = vi.hoisted(() => ({
  create: vi.fn(),
  parse: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    responses = { create, parse };
  },
}));
const config: Config = {
  production: false,
  port: 0,
  appUrl: "http://localhost:5173",
  apiUrl: "http://localhost:4000",
  demo: true,
  memory: !process.env.TEST_DATABASE_URL,
  databaseUrl: process.env.TEST_DATABASE_URL,
  externalAi: true,
  regulatoryFetch: false,
  repositoryFetch: false,
};
const files = [
  {
    path: "README.md",
    content:
      "# Atlas\nThe guide covers 19 chapters across workspace setup, files and administration with manual checklists.\nA collaboration service for teams to share documents and discuss business projects securely.\nRelease blocked pending license policy review.",
  },
  {
    path: "package.json",
    content:
      '{"dependencies":{"react":"1","openai":"1","pg":"1"},"scripts":{"prepare":"DO_NOT_EXECUTE"}}',
  },
  {
    path: "server/access.ts",
    content:
      'const email = user.email;\nconst storage = postgres;\nif (!hasPermission(user, document)) return status(403);\nconst provider = openai;\nconst apiKey = "ghp_abcdefghijklmnopqrstuvwxyz123456789";',
  },
];
const payload = {
  files,
  totalFiles: files.length,
  excludedFiles: 0,
  limitedFiles: 0,
};
let db: DB, uid: string, pid: string;
beforeEach(async () => {
  db = await createDb(config);
  uid = id();
  pid = id();
  await db.query(
    "INSERT INTO users (id,email,name,verified) VALUES ($1,$2,$3,true)",
    [uid, `${uid}@example.com`, "Owner"],
  );
  await db.query(
    "INSERT INTO projects (id,owner_id,profile) VALUES ($1,$2,$3)",
    [
      pid,
      uid,
      JSON.stringify({
        name: "Atlas",
        description: "A document collaboration app for adult business users.",
        softwareType: "saas",
        industry: "Technology",
        countries: ["EU"],
        audience: "Businesses",
        dataTypes: ["Personal data"],
        usesAi: true,
        externalAi: false,
        discovery: { provider: "local", repository: "", answers: {} },
      }),
    ],
  );
  create.mockReset();
  parse.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "test-only-fake-key");
});
afterEach(async () => {
  await db.end();
  vi.unstubAllEnvs();
});
async function complete() {
  for (let n = 0; n < 100; n++) {
    const scan = await latestScan(db, uid, pid);
    if (scan?.status !== "running") return scan;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("Scan did not finish");
}
it("reads source signals with exact references, redacts credentials and keeps markets unknown", () => {
  const report = analyzeSource(files, payload);
  expect(report.signals.map((s) => s.kind)).toEqual(
    expect.arrayContaining(["data", "storage", "access", "ai", "license"]),
  );
  expect(report.suggestions.access.references[0]).toMatchObject({
    path: "server/access.ts",
    line: 3,
  });
  expect(report.suggestions.markets.confidence).toBe("unknown");
  expect(report.suggestions.access.answer).toContain("not proof");
  expect(report.filesRead).toBe(3);
  expect(report.summary).toMatch(/^A collaboration service/);
  expect(redactSecrets(files[2].content)).not.toContain("ghp_abc");
  for (const path of [
    "../x.ts",
    "/x.ts",
    "a\\x.ts",
    ".env",
    "secrets/config.json",
    "node_modules/a.js",
    ".git/config",
    "private.key",
    "credentials.json",
    "data/users.json",
  ])
    expect(eligibleSource(path), path).toBe(false);
  expect(eligibleSource("server/access.ts")).toBe(true);
});
it("keeps private Git credentials only in scoped subprocess environment and rejects unsafe destinations", () => {
  const token = "private-test-token";
  const github = repositoryRequest("https://github.com/team/private", token);
  expect(github.repository).not.toContain(token);
  expect(github.env.GIT_CONFIG_KEY_4).toBe(
    "http.https://github.com/.extraHeader",
  );
  expect(github.env.GIT_CONFIG_VALUE_4).toBe(
    "Authorization: Basic " +
      Buffer.from("x-access-token:" + token).toString("base64"),
  );
  expect(github.env.GIT_CONFIG_VALUE_0).toBe("false");
  expect(github.env.GIT_TERMINAL_PROMPT).toBe("0");
  expect(github.env.OPENAI_API_KEY).toBeUndefined();
  expect(
    repositoryRequest("https://bitbucket.org/team/repo", token).env
      .GIT_CONFIG_VALUE_4,
  ).toBe("Authorization: Bearer " + token);
  for (const url of [
    "http://github.com/a/b",
    "https://evil.test/a/b",
    "https://github.com.evil.test/a/b",
    "https://x:password@github.com/a/b",
    "file:///tmp/repo",
    "https://github.com/a/b?token=secret",
  ])
    expect(() => repositoryRequest(url)).toThrow();
  expect(() =>
    repositoryRequest("https://github.com/a/b", "bad\r\nHeader: secret"),
  ).toThrow();
});
it("persists bounded scan reports and metadata, not full source or tokens; denies foreign projects and malformed source", async () => {
  await expect(
    startScan(db, config, "other", pid, payload, true),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    startScan(db, config, uid, pid, { ...payload, totalFiles: 99 }, true),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    startScan(
      db,
      config,
      uid,
      pid,
      {
        ...payload,
        files: [...files.slice(0, 2), { path: ".env", content: "secret" }],
      },
      true,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await startScan(db, config, uid, pid, payload, true);
  const scan = await complete();
  expect(scan.status).toBe("completed");
  expect(scan.report.filesRead).toBe(3);
  expect(JSON.stringify(scan)).not.toMatch(/ghp_abc|DO_NOT_EXECUTE/);
  const profile = (
    await db.query("SELECT profile FROM projects WHERE id=$1", [pid])
  ).rows[0].profile;
  expect(profile.discovery.snapshot.technologyHints).toContain("openai");
  expect(profile.discovery.answers).toEqual({});
  expect(create).not.toHaveBeenCalled();
  expect(parse).not.toHaveBeenCalled();
  expect(scan.stale).toBe(false);
  profile.discovery.snapshot.generatedAt = "2026-01-01T00:00:00.000Z";
  await db.query("UPDATE projects SET profile=$1 WHERE id=$2", [
    JSON.stringify(profile),
    pid,
  ]);
  expect((await latestScan(db, uid, pid)).stale).toBe(true);
  await expect(latestScan(db, "other", pid)).rejects.toMatchObject({
    status: 404,
  });
});
it("reports AI configuration and provider failures without successful scans or raw provider errors", async () => {
  await expect(
    startScan(
      db,
      { ...config, externalAi: false },
      uid,
      pid,
      { ...payload, useAi: true },
      true,
    ),
  ).rejects.toMatchObject({ status: 503 });
  parse.mockRejectedValue(new Error("PRIVATE_PROVIDER_ERROR"));
  await startScan(db, config, uid, pid, { ...payload, useAi: true }, true);
  const scan = await complete();
  expect(scan.status).toBe("failed");
  expect(JSON.stringify(scan)).not.toContain("PRIVATE_PROVIDER_ERROR");
  expect(scan.report).toBeNull();
  await startScan(db, config, uid, pid, payload, true);
  expect((await complete()).status).toBe("completed");
});
it("accepts only model source references inside supplied excerpts and labels missing evidence unknown", async () => {
  parse.mockResolvedValue({
    output_parsed: {
      summary: "Document collaboration.",
      suggestions: [
        {
          question: "access",
          answer: "Ownership check found.",
          confidence: "observed",
          references: [
            { path: "server/access.ts", line: 3 },
            { path: "invented.ts", line: 1 },
            { path: "README.md", line: 999 },
          ],
        },
        {
          question: "markets",
          answer: "Unproven market guess",
          confidence: "inferred",
          references: [],
        },
      ],
    },
  });
  const report = await enrichAnalysis(
    config,
    analyzeSource(files, payload),
    files,
  );
  expect(report.mode).toBe("ai");
  expect(report.suggestions.access.references).toHaveLength(1);
  expect(report.suggestions.markets.confidence).toBe("unknown");
  expect(parse.mock.calls[0][0].store).toBe(false);
  expect(parse.mock.calls[0][0].input).not.toContain("ghp_abc");
});
it("drafts catalog rules separately, applies idempotently and blocks other owners", async () => {
  const draft = await draftRuleSet(db, config, uid, pid, {
    topic: "privacy and AI for EU software",
  });
  expect(draft.payload.mode).toBe("catalog");
  expect(draft.payload.checkedAt).toBeNull();
  expect(
    (await db.query("SELECT * FROM rules WHERE project_id=$1", [pid])).rows,
  ).toHaveLength(0);
  await expect(applyRuleSet(db, "other", pid, draft.id)).rejects.toMatchObject({
    status: 404,
  });
  await applyRuleSet(db, uid, pid, draft.id);
  await applyRuleSet(db, uid, pid, draft.id);
  expect(
    (await db.query("SELECT * FROM rules WHERE project_id=$1", [pid])).rows,
  ).toHaveLength(draft.payload.rules.length);
  expect(create).not.toHaveBeenCalled();
});
it("requires real search metadata and matching official citations before labeling rules current", async () => {
  create.mockResolvedValue({ output: [], output_text: "Uncited claims" });
  await expect(
    draftRuleSet(db, config, uid, pid, {
      topic: "current privacy rules",
      liveResearch: true,
    }),
  ).rejects.toMatchObject({ status: 502 });
  const source = sources[0].url;
  create.mockResolvedValue({
    output_text: "Official research",
    output: [
      { type: "web_search_call" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            annotations: [
              { type: "url_citation", title: "Official", url: source },
              {
                type: "url_citation",
                title: "Untrusted",
                url: "https://example.org/fake",
              },
            ],
          },
        ],
      },
    ],
  });
  parse.mockResolvedValue({
    output_parsed: {
      summary: "Review applicability.",
      rules: [
        {
          title: "Verified candidate",
          description: "Confirm applicability and document the review outcome.",
          severity: "high",
          source,
        },
        {
          title: "Invented source",
          description:
            "Must never be added because it lacks a searched citation.",
          severity: "high",
          source: "https://example.org/fake",
        },
      ],
    },
  });
  const draft = await draftRuleSet(db, config, uid, pid, {
    topic: "current privacy rules",
    liveResearch: true,
  });
  expect(draft.payload.mode).toBe("live");
  expect(draft.payload.checkedAt).toBeTruthy();
  expect(draft.payload.rules).toHaveLength(1);
  expect(draft.payload.sources).toHaveLength(1);
  expect(create.mock.calls.at(-1)![0].input).not.toContain("discovery");
});
it("runs local assistant tools and leaves rules for explicit application", async () => {
  await startScan(db, config, uid, pid, payload, true);
  await complete();
  const explain = await chat(db, config, uid, pid, {
    message: "Explain this project",
  });
  expect(explain.content).toContain("3 files analyzed");
  expect(explain.meta.mode).toBe("local");
  const assessment = await chat(db, config, uid, pid, {
    message: "Run assessment",
    action: "assess",
  });
  expect(assessment.meta.trace[0]).toEqual({
    tool: "run_assessment",
    status: "completed",
  });
  const rules = await chat(db, config, uid, pid, {
    message: "EU privacy and AI requirements",
    action: "rules",
  });
  expect(rules.meta.drafts).toHaveLength(1);
  expect(
    (await db.query("SELECT * FROM rules WHERE project_id=$1", [pid])).rows,
  ).toHaveLength(0);
  expect((await chatHistory(db, uid, pid)).length).toBe(6);
  await expect(chatHistory(db, "other", pid)).rejects.toMatchObject({
    status: 404,
  });
  expect(create).not.toHaveBeenCalled();
});
it("binds AI tools to the current owner and refuses unsupported actions even when requested by a model", async () => {
  create
    .mockResolvedValueOnce({
      output: [
        {
          type: "function_call",
          name: "approve_evidence",
          arguments: "{}",
          call_id: "bad",
        },
      ],
      output_text: "",
    })
    .mockResolvedValueOnce({
      output: [
        {
          type: "function_call",
          name: "get_project_context",
          arguments: '{"projectId":"another-project"}',
          call_id: "read",
        },
      ],
      output_text: "",
    })
    .mockResolvedValueOnce({
      output: [],
      output_text: "Only the current project was inspected.",
    });
  const result = await chat(db, config, uid, pid, {
    message: "Explain this project",
    allowAi: true,
  });
  expect(result.meta.trace).toEqual([
    { tool: "approve_evidence", status: "failed" },
    { tool: "get_project_context", status: "completed" },
  ]);
  const outputs = create.mock.calls[2][0].input.filter(
    (i: any) => i.type === "function_call_output",
  );
  expect(outputs[0].output).toContain("Unknown assistant tool");
  expect(outputs[1].output).toContain("Atlas");
  expect(outputs[1].output).not.toContain("another-project");
  expect(
    (await db.query("SELECT * FROM evidence WHERE project_id=$1", [pid])).rows,
  ).toHaveLength(0);
});
it("keeps browser mutations behind session, origin and ownership checks, and exposes configuration honestly", async () => {
  const app = createApp(db, config),
    browser = request.agent(app);
  await browser.post("/api/demo").set("Origin", config.appUrl).expect(200);
  const projects = (await browser.get("/api/projects")).body,
    foreign = projects[0].id;
  await browser.get(`/api/projects/${pid}/analysis`).expect(404);
  await browser
    .post(`/api/projects/${foreign}/source-analysis`)
    .set("Origin", "https://evil.test")
    .send(payload)
    .expect(403);
  await browser
    .post(`/api/projects/${foreign}/repository-scan`)
    .set("Origin", config.appUrl)
    .send({ repository: "https://github.com/team/repo" })
    .expect(503);
  const key = (
    await browser
      .post("/api/keys")
      .set("Origin", config.appUrl)
      .send({ name: "Agent", scopes: ["read", "assess", "evidence"] })
  ).body.key;
  for (const path of [
    "source-analysis",
    "repository-scan",
    "assistant",
    "rule-sets",
  ])
    await request(app)
      .post(`/api/projects/${foreign}/${path}`)
      .set("Authorization", `Bearer ${key}`)
      .send(payload)
      .expect(403);
});
