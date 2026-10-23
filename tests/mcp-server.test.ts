import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
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
    expect(tools).toEqual(expect.arrayContaining(["acai_start", "acai_run_audit", "acai_review", "acai_begin_fix", "acai_complete_fix", "acai_wait_for_review"]));
    expect(tools).toEqual(expect.arrayContaining(["acai_projects", "acai_list_files", "acai_read_file", "acai_search_code", "acai_edit_file", "acai_write_file"]));
    const prompt = await client.getPrompt({ name: "audit" });
    expect(JSON.stringify(prompt.messages)).toContain("The human decides");
    const res = await client.readResource({ uri: "acai://playbook" });
    expect(String((res.contents[0] as { text: string }).text)).toContain("acai_begin_fix");
  });

  it("lets clients without repository access find the project and read its code, confined to the project", async () => {
    const projects = json(await call("acai_projects"));
    expect(projects).toHaveLength(1);
    expect(projects[0].default).toBe(true);
    expect((await call("acai_list_files", { glob: "src/**/*.js" })).content[0].text).toContain("src/server.js");
    expect((await call("acai_read_file", { path: "src/server.js", start_line: 1, end_line: 20 })).content[0].text).toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    expect((await call("acai_search_code", { pattern: "NODE_TLS_REJECT" })).content[0].text).toMatch(/^src\/server\.js:\d+:/);
    expect((await call("acai_read_file", { path: "../../../etc/hosts" })).isError).toBe(true);
    expect((await call("acai_read_file", { path: ".git/config" })).isError).toBe(true);
    // Edits only happen inside a fix.
    expect((await call("acai_write_file", { finding_id: "F-001", path: "src/evil.js", content: "x" })).isError).toBe(true);
  });

  it("starts by classifying the product and drafting answers", async () => {
    const r = json(await call("acai_start"));
    expect(r.classification.productTypes).toEqual(expect.arrayContaining(["backend-api", "ai-system"]));
    expect(r.answers.dataCategories.confirmed).toBe(false);
    expect(r.presets.length).toBeGreaterThan(5);
    expect(r.dashboard).toBe("http://127.0.0.1:4317");
  });

  it("saves answers the user gave and shows the resulting scope", async () => {
    json(await call("acai_apply_preset", { preset: "telehealth-platform-eu" }));
    const r = json(await call("acai_answer", { answers: { orgSize: "small" }, confirm_ids: ["markets", "dataCategories"], user_confirmed: true, purpose: "Telehealth booking with AI triage for patients in Romania and Germany." }));
    expect(r.frameworks).toEqual(expect.arrayContaining(["GDPR", "EU AI Act"].map((x) => expect.stringContaining(x.split(" ")[0]))));
    const scope = json(await call("acai_scope"));
    expect(scope.find((s: { id: string }) => s.id === "gdpr").active).toBe(true);
  });

  it("runs the audit and returns investigation batches", async () => {
    const r = json(await call("acai_run_audit"));
    auditId = r.audit_id;
    expect(r.detector_findings.length).toBeGreaterThan(10);
    expect(r.batches.map((b: { id: string }) => b.id)).toContain("ai");
    const controls = json(await call("acai_controls", { batch: "ai" }));
    expect(controls[0]).toHaveProperty("check");
  });

  it("records host findings and refuses review decisions without user confirmation", async () => {
    const recorded = json(
      await call("acai_record_findings", {
        findings: [{ title: "No account deletion endpoint", description: "Patients cannot delete their account or data.", severity: "high", category: "privacy-rights", control_ids: ["gdpr:Art.17"], locations: [{ path: "src/server.js", line: 70 }], evidence: "Searched routes for delete/erase; none.", recommendation: "Add DELETE /api/patients/me with cascading erasure." }],
      }),
    );
    expect(recorded[0].source).toBe("mcp-host");
    const denied = await call("acai_review", { finding_id: recorded[0].id, action: "confirm" });
    expect(denied.isError).toBe(true);
  });

  it("relays the user's decision, then fixes through Acai's edit tool and verification", async () => {
    const list = json(await call("acai_findings", { status: ["open"] }));
    const tls = list.findings.find((f: { title: string }) => /TLS certificate verification/.test(f.title));
    expect((await call("acai_tasks")).content[0].text).toMatch(/No confirmed findings to fix\. \d+ finding\(s\) still wait for the user's review/);
    json(await call("acai_review", { finding_id: tls.id, action: "confirm", user_confirmed: true }));
    const tasks = (await call("acai_tasks")).content[0].text;
    expect(tasks).toContain(`## 1. ${tls.id}`);
    expect(tasks).toContain("call `acai_begin_fix` before editing");
    expect((await call("acai_begin_fix", { finding_id: tls.id })).isError).toBe(true); // commands not approved yet
    json(await call("acai_verify_config", { approve: true, user_confirmed: true }));
    const begin = json(await call("acai_begin_fix", { finding_id: tls.id }));
    expect(begin.verify_commands).toEqual(["npm test"]);
    // A client without file access (ChatGPT, Claude.ai) edits through Acai; Claude Code would use its own tools.
    const line = /^.*NODE_TLS_REJECT_UNAUTHORIZED.*$/m.exec(readFileSync(join(repo.dir, "src/server.js"), "utf8"))![0];
    const edited = await call("acai_edit_file", { finding_id: tls.id, path: "src/server.js", old_string: line, new_string: "" });
    expect(edited.isError).toBeFalsy();
    const done = json(await call("acai_complete_fix", { finding_id: tls.id, summary: "Removed the global TLS verification override." }));
    expect(done.ok).toBe(true);
    expect(done.status).toBe("fix_ready");
    expect(done.verification[0].passed).toBe(true);
    const accepted = json(await call("acai_review", { finding_id: tls.id, action: "accept-fix", user_confirmed: true }));
    expect(accepted.status).toBe("resolved");
  });

  it("produces a report", async () => {
    const r = await call("acai_report", { format: "md" });
    expect(r.content[0].text).toContain("# Compliance audit");
    expect(auditId).toMatch(/^audit-/);
  });
});

describe("HTTP server security", () => {
  const repo = exampleRepo("credit-scoring-ml");
  // Accounts live in ACAI_HOME/auth.json: never the developer's own.
  const home = mkdtempSync(join(tmpdir(), "acai-home-"));
  const env = { ...process.env };
  beforeAll(() => {
    process.env.ACAI_HOME = home;
    for (const k of ["ACAI_TOKEN", "ACAI_TOKENS", "ACAI_ADMIN_TOKEN", "ACAI_ADMINS", "ACAI_APPROVERS", "ACAI_PUBLIC_URL"]) delete process.env[k];
  });
  afterAll(() => {
    process.env = env;
    repo.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

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

  it("tells the dashboard how to connect each agent", async () => {
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      const info: any = await (await fetch(`${url}/api/connect?url=${encodeURIComponent(`${url}/mcp`)}&project=${p.id}`)).json();
      expect(info).toMatchObject({ mcpUrl: `${url}/mcp`, auth: "none", oauth: false, project: { id: p.id, root: repo.dir } });
      expect(info.clients).toHaveLength(12);
      const by = (id: string) => info.clients.find((c: { id: string }) => c.id === id);
      const claudeCode = by("claude-code").local.blocks.filter((b: { kind: string }) => b.kind === "code");
      expect(claudeCode[0].text).toContain(`claude mcp add acai -- `);
      expect(claudeCode[0].text).toContain(`mcp ${repo.dir} --dashboard`);
      expect(JSON.parse(claudeCode[1].text).mcpServers.acai.args.slice(-3)).toEqual(["mcp", ".", "--dashboard"]);
      expect(by("codex").remote.blocks[0].text).toContain(`url = "${url}/mcp"`);
      // ChatGPT cannot reach a localhost server: it gets the HTTPS setup instead of connector steps.
      expect(by("chatgpt").local).toBeNull();
      expect(JSON.stringify(by("chatgpt").remote)).toContain("ACAI_PUBLIC_URL");
      // The browser-supplied URL is only echoed when it looks like an MCP endpoint.
      const odd: any = await (await fetch(`${url}/api/connect?url=${encodeURIComponent("javascript:alert(1)//mcp")}`)).json();
      expect(odd.mcpUrl).toBe(`${url}/mcp`);
    } finally {
      server.close();
    }
  });

  it("loads a reviewer's own rule file from the project's rules folder on reload", async () => {
    const tele = exampleRepo("telehealth-api");
    const projects = new Projects({ persist: false });
    const p = projects.add(tele.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    const post = (path: string, body: unknown = {}) =>
      fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Acai-Request": "1" }, body: JSON.stringify(body) });
    try {
      const registry: any = await (await fetch(`${url}/api/registry`)).json();
      expect(registry.batches).toHaveLength(8);
      expect(registry.ruleTemplate).toContain("id: internal-security-policy");
      const [listed]: any = await (await fetch(`${url}/api/projects`)).json();
      mkdirSync(listed.rulesDir, { recursive: true });
      writeFileSync(join(listed.rulesDir, "internal-security-policy.yaml"), registry.ruleTemplate);
      const reloaded: any = await (await post("/api/registry/reload")).json();
      expect(reloaded[0].errors).toEqual([]);
      expect(reloaded[0].frameworks).toBe(registry.frameworks.length + 1);
      await post(`/api/projects/${p.id}/answers`, { values: { dataCategories: ["health"], productTypes: ["backend-api"] } });
      const scope: any = await (await fetch(`${url}/api/projects/${p.id}/scope`)).json();
      expect(scope.find((s: { frameworkId: string }) => s.frameworkId === "internal-security-policy")).toMatchObject({ active: true, controls: 1 });
      // A broken file is skipped and reported, not fatal.
      writeFileSync(join(listed.rulesDir, "broken.yaml"), "id: not-the-file-name\n");
      const broken: any = await (await post("/api/registry/reload")).json();
      expect(broken[0].errors.length).toBe(1);
    } finally {
      server.close();
      tele.cleanup();
    }
  });

  it("refuses to listen on a network interface without tokens", async () => {
    const projects = new Projects({ persist: false });
    await expect(startServer({ projects, provider: null, host: "0.0.0.0", port: 0 })).rejects.toThrow(/without authentication/);
  });

  it("requires a valid per-user token when ACAI_TOKENS is set, and attributes actions to that user", async () => {
    process.env.ACAI_TOKENS = "alice:alice-token-0123456789abcdef,bob:bob-token-0123456789abcdef";
    process.env.ACAI_ADMINS = "alice"; // bob is a member
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    try {
      expect((await fetch(`${url}/api/meta`)).status).toBe(401);
      expect((await fetch(`${url}/api/meta`, { headers: { Authorization: "Bearer wrong-token-0123456789" } })).status).toBe(401);
      const meta: any = await (await fetch(`${url}/api/meta`, { headers: { Authorization: "Bearer bob-token-0123456789abcdef" } })).json();
      expect(meta.user).toBe("bob");
      const h = { Authorization: "Bearer bob-token-0123456789abcdef", "X-Acai-Request": "1", "Content-Type": "application/json", "X-Acai-User": "mallory" };
      const audit: any = await (await fetch(`${url}/api/projects/${p.id}/audits`, { method: "POST", headers: h, body: JSON.stringify({ mode: "static" }) })).json();
      expect(audit.audit.id).toMatch(/^audit-/);
      const journal: any = await (await fetch(`${url}/api/projects/${p.id}/journal`, { headers: h })).json();
      expect(journal.entries[0].actor.name).toBe("bob");
      // Shared servers: no registering arbitrary directories, and only administrators (or ACAI_APPROVERS) may approve commands.
      const add = await fetch(`${url}/api/projects`, { method: "POST", headers: h, body: JSON.stringify({ path: "/" }) });
      expect(add.status).toBe(409);
      const approve = await fetch(`${url}/api/projects/${p.id}/verify`, { method: "POST", headers: h, body: JSON.stringify({ commands: ["echo ok"], approve: true }) });
      expect(approve.status).toBe(403);
      const ah = { ...h, Authorization: "Bearer alice-token-0123456789abcdef" };
      expect((await fetch(`${url}/api/projects/${p.id}/verify`, { method: "POST", headers: ah, body: JSON.stringify({ commands: ["echo ok"], approve: true }) })).status).toBe(200);
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
      delete process.env.ACAI_TOKENS;
      delete process.env.ACAI_ADMINS;
      server.close();
    }
  });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe("Remote MCP with OAuth (ChatGPT, Claude.ai connectors)", () => {
  const repo = exampleRepo("credit-scoring-ml");
  const home = mkdtempSync(join(tmpdir(), "acai-home-"));
  const env = { ...process.env };
  afterAll(() => {
    process.env = env;
    repo.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

  const serve = async (tokens: string) => {
    const port = await freePort();
    Object.assign(process.env, { ACAI_HOME: home, ACAI_TOKENS: tokens, ACAI_PUBLIC_URL: `http://127.0.0.1:${port}` });
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const s = await startServer({ projects, provider: null, host: "127.0.0.1", port });
    return { ...s, project: p, close: () => (s.server.closeAllConnections(), s.server.close()) };
  };

  it("registers the client, asks the person for their Acai token, and issues tokens bound to that reviewer", async () => {
    const srv = await serve("alice:alice-token-0123456789abcdef");
    const { url } = srv;
    let tokens: OAuthTokens | undefined;
    try {
      // Discovery: a 401 points at the protected-resource metadata, which names the authorization server.
      const denied = await fetch(`${url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toContain(`${url}/.well-known/oauth-protected-resource/mcp`);
      const prm: any = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
      expect(prm).toMatchObject({ resource: `${url}/mcp`, authorization_servers: [`${url}/`] });

      // The SDK's own client-side OAuth, as Claude Code, Cursor and other hosts use it.
      let info: OAuthClientInformationMixed | undefined;
      let verifier = "";
      let authUrl: URL | undefined;
      const redirect = "http://127.0.0.1:9/callback";
      const provider: OAuthClientProvider = {
        redirectUrl: redirect,
        clientMetadata: { client_name: "ChatGPT", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
        clientInformation: () => info,
        saveClientInformation: (i) => void (info = i),
        tokens: () => tokens,
        saveTokens: (t) => void (tokens = t),
        redirectToAuthorization: (u) => void (authUrl = u),
        saveCodeVerifier: (v) => void (verifier = v),
        codeVerifier: () => verifier,
        state: () => "state-123",
      };
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { authProvider: provider });
      await expect(new Client({ name: "chatgpt", version: "1" }).connect(transport)).rejects.toThrow(/Unauthorized/i);
      expect(info?.client_id).toBeTruthy();

      // Consent page: a wrong token is refused; the right one sends the person back with a code.
      const page = await fetch(authUrl!);
      expect(page.headers.get("content-security-policy")).toContain("form-action 'self' http://127.0.0.1:9");
      const html = await page.text();
      expect(html).toContain("ChatGPT");
      const request = /name="request" value="([^"]+)"/.exec(html)![1];
      const consent = (token: string) =>
        fetch(`${url}/oauth/consent`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ request, token, action: "allow" }) });
      expect((await consent("wrong-token-0123456789abcdef")).status).toBe(401);
      const approved = await consent("alice-token-0123456789abcdef");
      expect(approved.status).toBe(302);
      const back = new URL(approved.headers.get("location")!);
      expect(back.origin + back.pathname).toBe(redirect);
      expect(back.searchParams.get("state")).toBe("state-123");
      expect((await consent("alice-token-0123456789abcdef")).status).toBe(400); // the request is single use

      await transport.finishAuth(back.searchParams.get("code")!);
      const client = new Client({ name: "chatgpt", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { authProvider: provider }));
      const listed = json(await client.callTool({ name: "acai_projects", arguments: {} }));
      expect(listed[0].id).toBe(srv.project.id);
      await client.callTool({ name: "acai_start", arguments: {} });
      await client.close();
      const journal: any = await (await fetch(`${url}/api/projects/${srv.project.id}/journal`, { headers: { Authorization: "Bearer alice-token-0123456789abcdef" } })).json();
      expect(journal.entries[0].actor.name).toBe("alice via ChatGPT (relaying the user)");
      const connect: any = await (await fetch(`${url}/api/connect`, { headers: { Authorization: "Bearer alice-token-0123456789abcdef" } })).json();
      expect(connect.oauth).toBe(true);
      expect(JSON.stringify(connect.clients.find((c: { id: string }) => c.id === "chatgpt").remote)).toContain(`MCP server URL \`${url}/mcp\``);

      // Only hashes are stored, readable by the owner alone.
      const stored = readFileSync(join(home, "oauth.json"), "utf8");
      expect(stored).not.toContain(tokens!.access_token);
      expect(statSync(join(home, "oauth.json")).mode & 0o077).toBe(0);

      // Refresh tokens rotate: each one works once.
      const refresh = () =>
        fetch(`${url}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens!.refresh_token!, client_id: info!.client_id }) });
      const first = await refresh();
      expect(first.status).toBe(200);
      expect((await refresh()).status).toBe(400);
      tokens = (await first.json()) as OAuthTokens;
    } finally {
      srv.close();
    }

    const mcpWith = (u: string) => fetch(`${u}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${tokens!.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    // Grants survive a restart...
    const again = await serve("alice:alice-token-0123456789abcdef");
    try {
      expect((await mcpWith(again.url)).status).toBe(200);
    } finally {
      again.close();
    }
    // ...and rotating the reviewer's Acai token revokes them.
    const rotated = await serve("alice:alice-new-token-0123456789abcdef");
    try {
      expect((await mcpWith(rotated.url)).status).toBe(401);
    } finally {
      rotated.close();
    }
  });
});
