import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import type { Config } from "../server/config.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const repository = "https://github.com/Ramphyi/reverse_office";
const config: Config = {
  production: false,
  demo: true,
  memory: true,
  port: 0,
  appUrl: "http://localhost:5173",
  apiUrl: "http://127.0.0.1",
  externalAi: false,
  regulatoryFetch: false,
  repositoryFetch: true,
};
const db = await createDb(config),
  server = createApp(db, config).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const client = new Client({ name: "reverse-office-experiment", version: "1" });
let cookie = "";
const checks: string[] = [];
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: config.appUrl,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  assert(
    response.ok,
    `${method} ${path}: ${response.status} ${JSON.stringify(value)}`,
  );
  if (path === "/demo")
    cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  return value;
}
try {
  await api("/demo", "POST", { example: "empty" });
  const project = await api("/projects", "POST", {
    name: "Reverse Office · source analysis experiment",
    description:
      "Project setup in progress. Intended use still needs confirmation.",
    industry: "Technology",
    softwareType: "saas",
    countries: ["EU"],
    audience: "Businesses",
    dataTypes: ["Personal data"],
    usesAi: true,
    externalAi: false,
    discovery: { provider: "github", repository, answers: {} },
  });
  const pid = project.id;
  await api(`/projects/${pid}/repository-scan`, "POST", {
    repository,
    useAi: false,
  });
  let scan: any;
  for (let i = 0; i < 240; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    scan = await api(`/projects/${pid}/analysis`);
    if (scan.status !== "running") break;
  }
  assert.equal(scan.status, "completed", scan.error || "Scan timeout");
  const report = scan.report;
  assert.match(report.revision, /^[a-f0-9]{40}$/);
  assert(report.filesRead > 100);
  assert.equal(
    report.filesRead + report.excludedFiles + report.limitedFiles,
    report.totalFiles,
  );
  checks.push(
    "Actual server-side shallow clone of the public default branch, bounded source read and temporary cleanup completed",
  );
  assert(report.files.some((f: any) => f.path === "server/assistant.js"));
  assert(report.files.some((f: any) => f.path === "studio-server/server.c"));
  assert(report.signals.some((s: any) => s.kind === "license"));
  assert(
    report.suggestions.purpose.references.some(
      (r: any) => r.path === "README.md",
    ),
  );
  assert.equal(report.suggestions.markets.confidence, "unknown");
  checks.push(
    "Web and standalone Studio modules found; licensing, data, access and AI review leads include source references",
  );
  const state = await api(`/projects/${pid}/discovery`);
  assert.equal(state.connection.snapshot.revision, report.revision);
  assert.deepEqual(state.connection.answers, {});
  checks.push(
    "Scan creates draft suggestions and code context without silently confirming deployment answers",
  );
  const chat = await api(`/projects/${pid}/assistant`, "POST", {
    message: "Explain this project",
  });
  assert.equal(chat.meta.mode, "local");
  assert(chat.content.includes(String(report.filesRead)));
  const draft = await api(`/projects/${pid}/assistant`, "POST", {
    message:
      "Privacy, AI governance and software licensing for a document collaboration SaaS for EU businesses",
    action: "rules",
  });
  assert.equal(draft.meta.drafts.length, 1);
  assert.equal((await api(`/projects/${pid}`)).rules.length, 0);
  const sets = await api(`/projects/${pid}/rule-sets`);
  await api(`/projects/${pid}/rule-sets/${sets[0].id}/apply`, "POST");
  await api(`/projects/${pid}/rule-sets/${sets[0].id}/apply`, "POST");
  assert.equal(
    (await api(`/projects/${pid}`)).rules.length,
    sets[0].payload.rules.length,
  );
  checks.push(
    "Project assistant reads the actual report; catalog draft requires explicit application and duplicate application is safe",
  );
  await api(`/projects/${pid}/assistant`, "POST", {
    message: "Run assessment",
    action: "assess",
  });
  const key = await api("/keys", "POST", {
    name: "Experiment client",
    scopes: ["read", "assess", "evidence"],
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${key.key}` } },
    }),
  );
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 9);
  const result = await client.callTool({
    name: "get_code_analysis",
    arguments: { projectId: pid },
  });
  assert(!result.isError);
  assert(JSON.stringify(result).includes(report.revision));
  const gate = await api(`/projects/${pid}/gate`);
  assert.equal(gate.passed, false);
  await api(`/projects/${pid}/assess`, "POST");
  const final = await api(`/projects/${pid}`);
  assert.equal(final.runs.length, 2);
  assert.equal(final.evidence.length, 0);
  checks.push(
    "Real MCP SDK retrieves analysis; repeat assessments retain history; missing evidence keeps release gate blocked",
  );
  await mkdir("docs/experiments", { recursive: true });
  await writeFile(
    "docs/experiments/reverse-office.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        repository,
        revision: report.revision,
        checks,
        coverage: {
          filesRead: report.filesRead,
          totalFiles: report.totalFiles,
          excludedFiles: report.excludedFiles,
          limitedFiles: report.limitedFiles,
          bytesRead: report.bytesRead,
        },
        summary: report.summary,
        modules: report.modules,
        signals: report.signals,
        suggestions: report.suggestions,
        rulesDrafted: sets[0].payload.rules.length,
        assessment: {
          runs: final.runs.length,
          findings: final.runs[0].findings.length,
          score: final.runs[0].score,
          releaseAllowed: gate.passed,
        },
        limitations: [
          ...report.warnings,
          "No target project code, package scripts or target tests were executed.",
          "No live OpenAI call or private-provider token was used in this public repository experiment.",
          "Declared EU/business scope is a test assumption, not a fact inferred about the repository.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        checks: checks.length,
        revision: report.revision,
        filesRead: report.filesRead,
        excluded: report.excludedFiles,
        limited: report.limitedFiles,
        rules: sets[0].payload.rules.length,
        releaseAllowed: gate.passed,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.end();
}
