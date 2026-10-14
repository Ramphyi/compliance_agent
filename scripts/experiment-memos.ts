import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import type { Config } from "../server/config.js";

const exec = promisify(execFile);
const expectedCommit = "8120a6cee03003ee7968b49b2109f816fa4d96a4";
const directory = resolve(process.argv[2] || ".local/memos");
const { stdout: revision } = await exec(
  "git",
  ["-C", directory, "rev-parse", "HEAD"],
  { windowsHide: true },
);
assert.equal(
  revision.trim(),
  expectedCommit,
  "Use the pinned Memos commit documented in the field note.",
);
const { stdout: inventoryJson } = await exec(
  process.execPath,
  ["scripts/inspect-repository.mjs", directory],
  { windowsHide: true, maxBuffer: 2_000_000 },
);
const inventory = JSON.parse(inventoryJson);
assert(inventory.technologyHints.includes("react"));
assert(inventory.technologyHints.includes("Go"));
assert(inventory.technologyHints.includes("openai-go"));
assert(inventory.manifests.some((m: any) => m.path === "web/package.json"));
assert(inventory.artifacts.tests.some((p: string) => p.endsWith("_test.go")));
assert(inventory.artifacts.licenses.includes("LICENSE"));
assert(
  (await readFile(resolve(directory, "LICENSE"), "utf8")).startsWith(
    "MIT License",
  ),
);
const config: Config = {
  production: false,
  port: 0,
  appUrl: "http://localhost:5173",
  apiUrl: "http://127.0.0.1",
  demo: true,
  memory: true,
  externalAi: false,
  regulatoryFetch: false,
};
const db = await createDb(config);
const server = createApp(db, config).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const client = new Client({
  name: "clearance-memos-experiment",
  version: "1.0.0",
});
const steps: string[] = [
  "Pinned repository verified",
  "Nested React and Go discovery verified",
  "Go tests and MIT license discovered",
];
let cookie = "";
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Origin: config.appUrl,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `API ${method} ${path} returned ${response.status}`);
  if (path === "/demo")
    cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  return response.json();
}
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  assert(!result.isError, `MCP ${name} returned a tool error`);
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find((c) => c.type === "text")!.text!);
}
try {
  await api("/demo", "POST");
  const profile = {
    name: "Memos · EU deployment experiment",
    description:
      "A hypothetical operator offers a self-hosted Memos-based notes service to adult business users in the EU. Notes and account records can contain personal data. Optional AI integrations in the pinned repository are included conservatively in scope; enabled deployment features still need owner confirmation.",
    industry: "Technology",
    softwareType: "saas",
    countries: ["EU"],
    audience: "Businesses",
    dataTypes: ["Personal data"],
    usesAi: true,
    externalAi: false,
  };
  const project = await api("/projects", "POST", profile);
  const policy = await api(`/projects/${project.id}/rules`, "POST", {
    title: "Review repository inventory and deployment scope",
    description:
      "An owner must review the pinned inventory and confirm which optional integrations are enabled before using it in the production release review.",
    severity: "high",
  });
  const key = await api("/keys", "POST", {
    name: "Isolated Memos experiment",
    scopes: ["read", "assess", "evidence"],
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${key.key}` } },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 9);
  const skill = await client.readResource({
    uri: "clearance://skills/assessment",
  });
  assert(skill.contents.length > 0);
  const projects = await call("list_projects", {});
  assert(projects.some((p: any) => p.id === project.id));
  steps.push(
    "Real MCP SDK initialization, tool discovery and skill resource passed",
  );
  const snapshot = {
    filesInspected: inventory.filesInspected,
    technologyHints: inventory.technologyHints,
    artifacts: Object.fromEntries(
      Object.entries(inventory.artifacts).map(([name, paths]) => [
        name,
        (paths as string[]).slice(0, 30),
      ]),
    ),
    truncated:
      inventory.truncated ||
      Object.values(inventory.artifacts).some(
        (paths) => (paths as string[]).length > 30,
      ),
    generatedAt: inventory.generatedAt,
    revision: expectedCommit,
  };
  await api(`/projects/${project.id}/connection`, "PUT", {
    provider: "github",
    repository: "https://github.com/usememos/memos",
  });
  await call("submit_code_snapshot", { projectId: project.id, snapshot });
  const questions = await call("get_project_questions", {
    projectId: project.id,
  });
  assert(questions.questions.some((q: any) => q.id === "ai"));
  steps.push(
    "MCP imported real Memos metadata and generated an AI-specific project question",
  );
  const answers = Object.fromEntries(
    questions.questions.map((q: any) => [
      q.id,
      q.id === "purpose"
        ? profile.description
        : q.id === "markets"
          ? "Hypothetical operator scenario: adult business users in the EU; not a claim about every Memos deployment."
          : q.id === "ai"
            ? "go.mod declares openai-go; provider/ai contains optional integrations. Whether deployed and what data reaches the model remain unverified."
            : "Unverified in this metadata-only experiment. The operator must investigate and provide implementation evidence before release.",
    ]),
  );
  await call("answer_project_questions", { projectId: project.id, answers });
  const answered = await call("get_project_questions", {
    projectId: project.id,
  });
  assert.equal(answered.unanswered.length, 0);
  steps.push(
    "MCP saved explicit scenario answers and unknowns without approving evidence",
  );
  const initial = await call("run_assessment", { projectId: project.id });
  assert.equal(initial.status, "completed");
  const evidence = await call("submit_evidence", {
    projectId: project.id,
    controlId: policy.id,
    title: "Pinned Memos repository metadata",
    content: inventoryJson,
  });
  assert.equal(evidence.status, "submitted");
  const stale = await call("check_release_gate", { projectId: project.id });
  assert.equal(stale.passed, false);
  assert.match(stale.reason, /Inputs changed/);
  steps.push(
    "MCP evidence submission remained unapproved and invalidated the prior gate",
  );
  const denied = await fetch(
    `${base}/api/projects/${project.id}/evidence/${evidence.id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${key.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "approved" }),
    },
  );
  assert.equal(denied.status, 403);
  steps.push("Bearer key could not approve evidence");
  const assessed = await call("run_assessment", { projectId: project.id });
  assert.equal(assessed.status, "completed");
  assert.equal(assessed.research, null);
  const custom = assessed.findings.find((f: any) => f.id === policy.id);
  assert.equal(custom.status, "review");
  assert.equal(assessed.score, 0);
  const gate = await call("check_release_gate", { projectId: project.id });
  assert.equal(gate.passed, false);
  assert(gate.blockers.length > 0);
  const cli = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/compliance-gate.mjs"], {
        windowsHide: true,
        env: {
          ...process.env,
          CLEARANCE_URL: base,
          CLEARANCE_PROJECT_ID: project.id,
          CLEARANCE_API_KEY: key.key,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (x) => (output += x));
      child.stderr.on("data", (x) => (output += x));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    },
  );
  assert.equal(cli.code, 1);
  assert.match(cli.output, /BLOCKED/);
  assert(!cli.output.includes(key.key));
  steps.push(
    "Real CLI exited 1 for unreviewed high-priority evidence, as expected",
  );
  await api(`/keys/${key.id}`, "DELETE");
  const revoked = await fetch(`${base}/api/projects`, {
    headers: { Authorization: `Bearer ${key.key}` },
  });
  assert.equal(revoked.status, 401);
  steps.push("Revoked key was denied further access");
  const report = {
    experiment: "Memos repository to MCP to CI",
    verifiedAt: new Date().toISOString(),
    result: "passed",
    source: {
      repository: "https://github.com/usememos/memos",
      commit: expectedCommit,
      license: "MIT",
    },
    runtime: {
      clearanceDatabase: "isolated pg-mem",
      targetApplicationExecuted: false,
      externalResearch: false,
    },
    profile,
    discovery: {
      provider: "github",
      repository: "https://github.com/usememos/memos",
      snapshot,
      importedAt: new Date().toISOString(),
      answers,
    },
    inventory: {
      filesInspected: inventory.filesInspected,
      truncated: inventory.truncated,
      depthLimit: inventory.depthLimit,
      technologyHints: inventory.technologyHints,
      manifests: inventory.manifests,
      testFilesDiscovered: inventory.artifacts.tests.length,
      pipelinesDiscovered: inventory.artifacts.pipelines.length,
      licenseFiles: inventory.artifacts.licenses,
    },
    checks: steps,
    assessment: {
      status: assessed.status,
      candidateControls: assessed.findings.length,
      approvedCoverage: assessed.score,
      findings: assessed.findings.map((f: any) => ({
        title: f.title,
        framework: f.framework,
        severity: f.severity,
        status: f.status,
      })),
    },
    releaseGate: {
      passed: gate.passed,
      reason: gate.reason,
      blockers: gate.blockers.length,
      cliExitCode: cli.code,
    },
    limitations: [
      "Deployment profile is an explicit hypothetical operator scenario, not a claim about all Memos installations.",
      "Memos code and tests were not executed. File discovery does not establish control implementation.",
      "No evidence was approved, no external provider was called and no compliance certification is implied.",
    ],
  };
  await mkdir("docs/experiments", { recursive: true });
  await writeFile(
    "docs/experiments/memos.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `PASS: ${steps.length} experiment checks. ${inventory.filesInspected} files discovered, ${assessed.findings.length} candidate controls. CI gate correctly blocked ${gate.blockers.length} unreviewed high-priority controls. Report: docs/experiments/memos.json`,
  );
} finally {
  await client.close();
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await db.end();
}
