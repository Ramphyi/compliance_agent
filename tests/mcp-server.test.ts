import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer } from "../packages/cli/src/mcp";
import { Projects } from "../packages/cli/src/projects";
import { startServer } from "../packages/cli/src/server";
import { exampleRepo } from "./helpers";

type Content = { content: { type: string; text: string }[]; isError?: boolean };
const json = (r: unknown) => JSON.parse((r as Content).content[0].text);

describe("MCP: a host agent drives the audit with its own harness", () => {
  const repo = exampleRepo("telehealth-api");
  const client = new Client({ name: "test-host", version: "1.0.0" });
  let auditId = "";

  beforeAll(async () => {
    const projects = new Projects({ persist: false });
    const entry = projects.add(repo.dir);
    const server = createMcpServer({ projects, defaultProject: entry.id, dashboardUrl: () => "http://127.0.0.1:4317" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
  });
  afterAll(async () => {
    await client.close();
    repo.cleanup();
  });

  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args }) as Promise<Content>;

  it("exposes the playbook prompt, resources and tools", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["assay_start", "assay_run_audit", "assay_review", "assay_begin_fix", "assay_complete_fix", "assay_wait_for_review"]));
    const prompt = await client.getPrompt({ name: "audit" });
    expect(JSON.stringify(prompt.messages)).toContain("The human decides");
    const res = await client.readResource({ uri: "assay://playbook" });
    expect(String((res.contents[0] as { text: string }).text)).toContain("assay_begin_fix");
  });

  it("starts by classifying the product and drafting answers", async () => {
    const r = json(await call("assay_start"));
    expect(r.classification.productTypes).toEqual(expect.arrayContaining(["backend-api", "ai-system"]));
    expect(r.answers.dataCategories.confirmed).toBe(false);
    expect(r.presets.length).toBeGreaterThan(5);
    expect(r.dashboard).toBe("http://127.0.0.1:4317");
  });

  it("saves answers the user gave and shows the resulting scope", async () => {
    json(await call("assay_apply_preset", { preset: "telehealth-platform-eu" }));
    const r = json(await call("assay_answer", { answers: { orgSize: "small" }, confirm_ids: ["markets", "dataCategories"], user_confirmed: true, purpose: "Telehealth booking with AI triage for patients in Romania and Germany." }));
    expect(r.frameworks).toEqual(expect.arrayContaining(["GDPR", "EU AI Act"].map((x) => expect.stringContaining(x.split(" ")[0]))));
    const scope = json(await call("assay_scope"));
    expect(scope.find((s: { id: string }) => s.id === "gdpr").active).toBe(true);
  });

  it("runs the audit and returns investigation batches", async () => {
    const r = json(await call("assay_run_audit"));
    auditId = r.audit_id;
    expect(r.detector_findings.length).toBeGreaterThan(10);
    expect(r.batches.map((b: { id: string }) => b.id)).toContain("ai");
    const controls = json(await call("assay_controls", { batch: "ai" }));
    expect(controls[0]).toHaveProperty("check");
  });

  it("records host findings and refuses review decisions without user confirmation", async () => {
    const recorded = json(
      await call("assay_record_findings", {
        findings: [{ title: "No account deletion endpoint", description: "Patients cannot delete their account or data.", severity: "high", category: "privacy-rights", control_ids: ["gdpr:Art.17"], locations: [{ path: "src/server.js", line: 70 }], evidence: "Searched routes for delete/erase; none.", recommendation: "Add DELETE /api/patients/me with cascading erasure." }],
      }),
    );
    expect(recorded[0].source).toBe("mcp-host");
    const denied = await call("assay_review", { finding_id: recorded[0].id, action: "confirm" });
    expect(denied.isError).toBe(true);
  });

  it("relays the user's decision, then fixes with the host's own edits and Assay's verification", async () => {
    const list = json(await call("assay_findings", { status: ["open"] }));
    const tls = list.findings.find((f: { title: string }) => /TLS certificate verification/.test(f.title));
    json(await call("assay_review", { finding_id: tls.id, action: "confirm", user_confirmed: true }));
    expect((await call("assay_begin_fix", { finding_id: tls.id })).isError).toBe(true); // commands not approved yet
    json(await call("assay_verify_config", { approve: true, user_confirmed: true }));
    const begin = json(await call("assay_begin_fix", { finding_id: tls.id }));
    expect(begin.verify_commands).toEqual(["npm test"]);
    // The host edits the file with its own tools.
    const file = join(repo.dir, "src/server.js");
    writeFileSync(file, readFileSync(file, "utf8").replace(/^.*NODE_TLS_REJECT_UNAUTHORIZED.*$/m, ""));
    const done = json(await call("assay_complete_fix", { finding_id: tls.id, summary: "Removed the global TLS verification override." }));
    expect(done.ok).toBe(true);
    expect(done.status).toBe("fix_ready");
    expect(done.verification[0].passed).toBe(true);
    const accepted = json(await call("assay_review", { finding_id: tls.id, action: "accept-fix", user_confirmed: true }));
    expect(accepted.status).toBe("resolved");
  });

  it("produces a report", async () => {
    const r = await call("assay_report", { format: "md" });
    expect(r.content[0].text).toContain("# Compliance audit");
    expect(auditId).toMatch(/^audit-/);
  });
});

describe("HTTP server security", () => {
  const repo = exampleRepo("credit-scoring-ml");
  afterAll(() => repo.cleanup());

  it("binds locally without auth and rejects foreign Host headers (DNS rebinding)", async () => {
    const projects = new Projects({ persist: false });
    projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      expect((await fetch(`${url}/api/meta`)).status).toBe(200);
      // fetch() cannot override Host, so use a raw request like a rebinding attack would.
      const status = await new Promise<number>((resolve, reject) => {
        const u = new URL(`${url}/api/meta`);
        request({ host: u.hostname, port: u.port, path: u.pathname, headers: { Host: "evil.example" } }, (res) => resolve(res.statusCode ?? 0)).on("error", reject).end();
      });
      expect(status).toBe(403);
      const noHeader = await fetch(`${url}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(noHeader.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("refuses to listen on a network interface without tokens", async () => {
    const projects = new Projects({ persist: false });
    await expect(startServer({ projects, provider: null, host: "0.0.0.0", port: 0 })).rejects.toThrow(/without authentication/);
  });

  it("requires a valid per-user token when ASSAY_TOKENS is set, and attributes actions to that user", async () => {
    process.env.ASSAY_TOKENS = "alice:alice-token-0123456789abcdef,bob:bob-token-0123456789abcdef";
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      expect((await fetch(`${url}/api/meta`)).status).toBe(401);
      expect((await fetch(`${url}/api/meta`, { headers: { Authorization: "Bearer wrong-token-0123456789" } })).status).toBe(401);
      const meta: any = await (await fetch(`${url}/api/meta`, { headers: { Authorization: "Bearer bob-token-0123456789abcdef" } })).json();
      expect(meta.user).toBe("bob");
      const h = { Authorization: "Bearer bob-token-0123456789abcdef", "X-Assay-Request": "1", "Content-Type": "application/json", "X-Assay-User": "mallory" };
      const audit: any = await (await fetch(`${url}/api/projects/${p.id}/audits`, { method: "POST", headers: h, body: JSON.stringify({ mode: "static" }) })).json();
      expect(audit.audit.id).toMatch(/^audit-/);
      const journal: any = await (await fetch(`${url}/api/projects/${p.id}/journal`, { headers: h })).json();
      expect(journal.entries[0].actor.name).toBe("bob");
      // Shared servers: no registering arbitrary directories, and only named approvers may approve commands.
      const add = await fetch(`${url}/api/projects`, { method: "POST", headers: h, body: JSON.stringify({ path: "/" }) });
      expect(add.status).toBe(409);
      process.env.ASSAY_APPROVERS = "alice";
      const approve = await fetch(`${url}/api/projects/${p.id}/verify`, { method: "POST", headers: h, body: JSON.stringify({ commands: ["echo ok"], approve: true }) });
      expect(approve.status).toBe(409);
      const ah = { ...h, Authorization: "Bearer alice-token-0123456789abcdef" };
      expect((await fetch(`${url}/api/projects/${p.id}/verify`, { method: "POST", headers: ah, body: JSON.stringify({ commands: ["echo ok"], approve: true }) })).status).toBe(200);
      delete process.env.ASSAY_APPROVERS;
      // Symlinks out of the project are not served.
      const { symlinkSync } = await import("node:fs");
      symlinkSync("/etc/hosts", join(repo.dir, "hosts-link"));
      expect((await fetch(`${url}/api/projects/${p.id}/file?path=hosts-link`, { headers: h })).status).not.toBe(200);
      // MCP over HTTP with the same token.
      const client = new Client({ name: "http-host", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: "Bearer alice-token-0123456789abcdef" } } }));
      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(15);
      await client.close();
    } finally {
      delete process.env.ASSAY_TOKENS;
      server.close();
    }
  });
});
