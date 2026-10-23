import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Projects } from "../packages/cli/src/projects";
import { startServer } from "../packages/cli/src/server";
import { normalizeRepo } from "../packages/cli/src/webhooks";
import { repoRoot } from "./helpers";

const SECRET = "webhook-secret-0123456789";
const GH = "https://github.com/acme/telehealth.git";
const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=dev", "-c", "user.email=dev@example.com", ...args], { stdio: "pipe" }).toString().trim();

describe("repository webhooks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "acai-hooks-"));
  const bare = join(tmp, "origin.git");
  const project = join(tmp, "server-clone");
  const dev = join(tmp, "dev-clone");
  const env = { ...process.env };
  const gh: { method: string; path: string; body?: any }[] = [];
  let fakeGitHub: Server;
  let url = "";
  let stop: () => void;
  let idle: () => Promise<void>;
  let pid = "";

  const send = (event: string, payload: unknown, secret = SECRET) => {
    const body = JSON.stringify(payload);
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    return fetch(`${url}/hooks/github`, { method: "POST", headers: { "Content-Type": "application/json", "X-GitHub-Event": event, "X-Hub-Signature-256": sig }, body });
  };
  const repository = { full_name: "acme/telehealth", clone_url: GH, ssh_url: "git@github.com:acme/telehealth.git" };
  const api = async (path: string, init?: RequestInit) => (await fetch(`${url}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Acai-Request": "1" } })).json() as Promise<any>;

  beforeAll(async () => {
    // A "GitHub" remote: a bare repository the server clone fetches from through insteadOf.
    const src = join(tmp, "src");
    execFileSync("cp", ["-R", join(repoRoot, "examples/apps/telehealth-api"), src]);
    git(src, "init", "-q", "-b", "main");
    git(src, "add", "-A");
    git(src, "commit", "-q", "-m", "initial");
    execFileSync("git", ["clone", "-q", "--bare", src, bare]);
    execFileSync("git", ["clone", "-q", bare, project]);
    git(project, "remote", "set-url", "origin", GH);
    git(project, "config", `url.${bare}.insteadOf`, GH);
    execFileSync("git", ["clone", "-q", bare, dev]);

    fakeGitHub = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : undefined;
        gh.push({ method: req.method!, path: req.url!, body });
        res.setHeader("Content-Type", "application/json");
        if (req.method === "GET") return res.end(JSON.stringify(gh.filter((c) => c.method === "POST" && c.path.endsWith("/comments")).map((c, i) => ({ id: 100 + i, body: c.body.body }))));
        res.statusCode = 201;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => fakeGitHub.listen(0, "127.0.0.1", r));
    const a = fakeGitHub.address();
    Object.assign(process.env, {
      ACAI_HOME: join(tmp, "home"),
      ACAI_WEBHOOK_SECRET: SECRET,
      GITHUB_TOKEN: "ghp_test",
      ACAI_GITHUB_API_URL: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`,
    });
    const projects = new Projects({ persist: false });
    pid = projects.add(project).id;
    const s = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    url = s.url;
    stop = () => s.server.close();
    idle = () => s.webhooks.idle();
  });
  afterAll(() => {
    stop?.();
    fakeGitHub?.close();
    process.env = env;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("matches repositories however they are written", () => {
    expect(normalizeRepo("https://github.com/Acme/App.git")).toBe("github.com/acme/app");
    expect(normalizeRepo("git@github.com:acme/app.git")).toBe("github.com/acme/app");
    expect(normalizeRepo("ssh://git@gitlab.example.com/group/app")).toBe("gitlab.example.com/group/app");
  });

  it("rejects unsigned deliveries and unknown repositories", async () => {
    expect((await send("push", { ref: "refs/heads/main", repository }, "wrong-secret-0123456789")).status).toBe(401);
    expect((await send("push", { ref: "refs/heads/main", repository: { full_name: "acme/other", clone_url: "https://github.com/acme/other.git" } })).status).toBe(404);
    expect((await send("ping", { repository })).status).toBe(200);
  });

  it("on a push, updates the project, audits it and sets a commit status", async () => {
    writeFileSync(join(dev, "src/checksum.js"), 'import crypto from "node:crypto";\nexport const sum = (s) => crypto.createHash("md5").update(s).digest("hex");\n');
    git(dev, "add", "-A");
    git(dev, "commit", "-q", "-m", "Add checksum");
    git(dev, "push", "-q", "origin", "main");
    const sha = git(dev, "rev-parse", "HEAD");

    expect((await send("push", { ref: "refs/heads/main", after: sha, repository })).status).toBe(202);
    await idle();
    expect(git(project, "rev-parse", "HEAD")).toBe(sha);
    const audits = await api(`/api/projects/${pid}/audits`);
    const audit = await api(`/api/projects/${pid}/audits/${audits[0].id}`);
    expect(audit.trigger).toMatchObject({ source: "webhook", provider: "github", event: "push", sha });
    expect(audit.findings.some((f: any) => f.locations.some((l: any) => l.path === "src/checksum.js"))).toBe(true);
    const status = gh.find((c) => c.path === `/repos/acme/telehealth/statuses/${sha}`)!;
    expect(status.body).toMatchObject({ state: "failure", context: "acai/compliance" });
    const auto = await api(`/api/projects/${pid}/automation`);
    expect(auto.deliveries[0]).toMatchObject({ status: "done", auditId: audit.id, reported: ["commit status"] });

    // The confirmed ones become instructions for a coding agent.
    const md = await (await fetch(`${url}/api/projects/${pid}/audits/${audit.id}/tasks?status=open`)).text();
    expect(md).toContain("## 1.");
    expect(md).toContain("**Done when:**");
    expect(md).toContain("`npm test`");
  });

  it("scans a pull request without touching the project, and comments what it adds and fixes", async () => {
    git(dev, "checkout", "-q", "-b", "feature");
    rmSync(join(dev, "src/checksum.js"));
    writeFileSync(join(dev, "src/upstream.js"), 'export const agent = { rejectUnauthorized: false };\n');
    git(dev, "add", "-A");
    git(dev, "commit", "-q", "-m", "Upstream agent");
    git(dev, "push", "-q", "origin", "feature");
    const sha = git(dev, "rev-parse", "HEAD");
    git(bare, "update-ref", "refs/pull/7/head", sha); // what GitHub does for every pull request

    const pr = { action: "opened", number: 7, pull_request: { number: 7, head: { sha, ref: "feature" }, base: { ref: "main" }, html_url: "https://github.com/acme/telehealth/pull/7" }, repository };
    expect((await send("pull_request", pr)).status).toBe(202);
    await idle();
    const d = (await api(`/api/projects/${pid}/automation`)).deliveries[0];
    expect(d.status).toBe("done");
    expect(d.pr).toMatchObject({ number: 7, added: 1, fixed: 1 });
    // The server's working tree is untouched and no worktree is left behind.
    expect(git(project, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(project, "status", "--porcelain", "--", ".", ":!.acai")).toBe("");
    expect(git(project, "worktree", "list").split("\n")).toHaveLength(1);

    const comment = gh.find((c) => c.method === "POST" && c.path === "/repos/acme/telehealth/issues/7/comments")!;
    expect(comment.body.body).toContain("adds **1 finding(s)**");
    expect(comment.body.body).toContain("src/upstream.js");
    expect(comment.body.body).toContain("Instructions for your coding agent");
    expect(gh.find((c) => c.path === `/repos/acme/telehealth/statuses/${sha}`)!.body.state).toBe("failure");

    // A new push to the pull request updates the same comment.
    await send("pull_request", { ...pr, action: "synchronize" });
    await idle();
    expect(gh.filter((c) => c.method === "PATCH" && c.path === "/repos/acme/telehealth/issues/comments/100")).toHaveLength(1);
  });

  it("follows the project's automation settings", async () => {
    const saved = await api(`/api/projects/${pid}/automation`, { method: "POST", body: JSON.stringify({ push: "off" }) });
    expect(saved.push).toBe("off");
    await send("push", { ref: "refs/heads/main", after: git(dev, "rev-parse", "main"), repository });
    await idle();
    expect((await api(`/api/projects/${pid}/automation`)).deliveries[0]).toMatchObject({ status: "ignored" });
    expect((await api(`/api/projects/${pid}/automation`, { method: "POST", body: JSON.stringify({ push: "sometimes" }) })).error).toBeTruthy();
  });
});
