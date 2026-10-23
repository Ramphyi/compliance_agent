import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import {
  type Actor, type Audit, type AuditTrigger, changedPaths, classify, currentBranch, type Finding, findingTasks, gate, head, investigate,
  type LlmProvider, scanProject, SEVERITIES, type Severity, staticAudit, summarize, tasksMarkdown, understandProduct, type Workspace,
} from "@acai/core";
import type { Jobs } from "./jobs";
import { acaiHome, type Projects } from "./projects";

/**
 * Repository webhooks: a push re-audits the project (detectors, or the full agent audit in
 * automatic mode); a pull request is scanned in a separate worktree and gets a report of what it
 * adds or fixes, with instructions a coding agent can follow. Results show in the dashboard and,
 * with GITHUB_TOKEN, as a commit status and a pull request comment.
 */
export type Provider = "github" | "gitlab" | "generic";

export type HookEvent = {
  provider: Provider;
  event: "push" | "pull_request" | "ping";
  /** owner/name or group/project, plus clone URLs, used to find the project. */
  repo: { name: string; urls: string[] };
  branch?: string;
  sha?: string;
  deleted?: boolean;
  pr?: { number: number; headSha: string; baseBranch?: string; url?: string };
};

export type Delivery = {
  id: string;
  at: string;
  provider: Provider;
  event: string;
  repo: string;
  ref?: string;
  sha?: string;
  projectId?: string;
  status: "queued" | "running" | "done" | "ignored" | "skipped" | "failed";
  message: string;
  auditId?: string;
  summary?: { total: number; bySeverity: Record<string, number> };
  pr?: { number: number; added: number; fixed: number; known: number; url?: string };
  reported?: string[];
};

const WEBHOOK: Actor = { type: "system", name: "webhook" };
const MARKER = "<!-- acai-compliance -->";
const sevRank = (s: Severity) => SEVERITIES.indexOf(s);

/** github.com/owner/repo from https, ssh (git@host:owner/repo) or a plain path. */
export function normalizeRepo(url: string) {
  return url
    .trim()
    .replace(/^[a-z+]+:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/^([^/:]+):(?!\d)/, "$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function parseEvent(provider: Provider, headers: Record<string, string | string[] | undefined>, body: any): HookEvent | null {
  const branchOf = (ref?: string) => (ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : undefined);
  if (provider === "github") {
    const kind = String(headers["x-github-event"] ?? "");
    const r = body.repository ?? {};
    const repo = { name: String(r.full_name ?? ""), urls: [r.clone_url, r.ssh_url, r.html_url, r.git_url].filter(Boolean) };
    if (kind === "ping") return { provider, event: "ping", repo };
    if (kind === "push") return { provider, event: "push", repo, branch: branchOf(body.ref), sha: body.after, deleted: Boolean(body.deleted) };
    if (kind === "pull_request" && ["opened", "synchronize", "reopened", "ready_for_review"].includes(body.action)) {
      const p = body.pull_request ?? {};
      return { provider, event: "pull_request", repo, sha: p.head?.sha, pr: { number: Number(p.number ?? body.number), headSha: p.head?.sha, baseBranch: p.base?.ref, url: p.html_url } };
    }
    return null;
  }
  if (provider === "gitlab") {
    const p = body.project ?? {};
    const repo = { name: String(p.path_with_namespace ?? ""), urls: [p.git_http_url, p.git_ssh_url, p.web_url].filter(Boolean) };
    if (body.object_kind === "push") return { provider, event: "push", repo, branch: branchOf(body.ref), sha: body.checkout_sha ?? body.after, deleted: !body.checkout_sha };
    if (body.object_kind === "merge_request" && ["open", "update", "reopen"].includes(body.object_attributes?.action)) {
      const m = body.object_attributes;
      return { provider, event: "pull_request", repo, sha: m.last_commit?.id, pr: { number: Number(m.iid), headSha: m.last_commit?.id, baseBranch: m.target_branch, url: m.url } };
    }
    return null;
  }
  // generic: { repository, ref?, sha?, pull_request?: { number?, head_sha, ref? } } from any CI or script.
  const repo = { name: String(body.repository ?? ""), urls: [String(body.repository ?? "")] };
  if (body.pull_request) {
    const pr = body.pull_request;
    return { provider, event: "pull_request", repo, sha: pr.head_sha, pr: { number: Number(pr.number ?? 0), headSha: pr.head_sha, baseBranch: pr.base, url: pr.url } };
  }
  return { provider, event: "push", repo, branch: branchOf(body.ref) ?? body.branch, sha: body.sha };
}

export function verifySignature(provider: Provider, headers: Record<string, string | string[] | undefined>, raw: Buffer, secret: string) {
  const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (provider === "gitlab") return eq(String(headers["x-gitlab-token"] ?? ""), secret);
  const sig = String(headers[provider === "github" ? "x-hub-signature-256" : "x-acai-signature"] ?? "");
  return eq(sig, `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
}

/** Runs git with GITHUB_TOKEN as an HTTP header for github.com (kept out of URLs and process arguments). */
function git(root: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const n = Number(env.GIT_CONFIG_COUNT ?? 0);
    env[`GIT_CONFIG_KEY_${n}`] = "http.https://github.com/.extraheader";
    env[`GIT_CONFIG_VALUE_${n}`] = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    env.GIT_CONFIG_COUNT = String(n + 1);
  }
  return execFileSync("git", ["-C", root, ...args], { env, stdio: "pipe", timeout: 300_000 }).toString();
}

export class Webhooks {
  private file = join(acaiHome(), "deliveries.json");
  private list: Delivery[];
  private queues = new Map<string, Promise<void>>();

  constructor(
    private o: {
      projects: Projects;
      jobs: Jobs;
      provider: () => LlmProvider | null;
      publicUrl?: string;
      /** Resolves repositories that are not registered yet (clone when ACAI_ALLOW_CLONE=true). */
      clone?: (url: string, name: string) => string | undefined;
    },
  ) {
    try {
      this.list = JSON.parse(readFileSync(this.file, "utf8")) as Delivery[];
    } catch {
      this.list = [];
    }
  }

  get secret() {
    const s = process.env.ACAI_WEBHOOK_SECRET ?? "";
    return s.length >= 16 ? s : undefined;
  }

  deliveries(projectId?: string) {
    return this.list.filter((d) => !projectId || d.projectId === projectId).slice(0, 50);
  }

  private save(d: Delivery) {
    const i = this.list.findIndex((x) => x.id === d.id);
    if (i >= 0) this.list[i] = d;
    else this.list.unshift(d);
    this.list = this.list.slice(0, 200);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.list, null, 1));
    renameSync(tmp, this.file);
  }

  /** Verifies and queues a delivery; answers at once (GitHub gives up after 10 seconds). */
  receive(provider: Provider, headers: Record<string, string | string[] | undefined>, raw: Buffer): { status: number; body: unknown } {
    const secret = this.secret;
    if (!secret) return { status: 503, body: { error: "Webhooks are off. Set ACAI_WEBHOOK_SECRET (at least 16 characters) on the server." } };
    if (!verifySignature(provider, headers, raw, secret)) return { status: 401, body: { error: "Invalid signature" } };
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return { status: 400, body: { error: "Send the webhook as JSON (content type application/json)" } };
    }
    const ev = parseEvent(provider, headers, payload);
    if (!ev) return { status: 202, body: { ignored: "Event not handled" } };
    if (ev.event === "ping") return { status: 200, body: { ok: true, message: "Acai is listening" } };
    const project = this.findProject(ev);
    const d: Delivery = {
      id: `dl-${randomBytes(4).toString("hex")}`,
      at: new Date().toISOString(),
      provider,
      event: ev.event === "pull_request" ? `pull request #${ev.pr?.number}` : `push to ${ev.branch ?? "?"}`,
      repo: ev.repo.name || ev.repo.urls[0] || "?",
      ref: ev.branch,
      sha: ev.sha,
      projectId: project?.id,
      status: "queued",
      message: "Queued",
    };
    if (!project) {
      this.save({ ...d, status: "ignored", message: `No project here for ${d.repo}. Add the repository in the dashboard (its origin remote must point to it).` });
      return { status: 404, body: { error: `No project for ${d.repo}` } };
    }
    this.save(d);
    // One delivery at a time per project: they share the working tree.
    const prev = this.queues.get(project.id) ?? Promise.resolve();
    const next = prev.then(() => this.process(d, ev)).catch(() => undefined);
    this.queues.set(project.id, next);
    return { status: 202, body: { accepted: d.id } };
  }

  /** Waits for every queued delivery (tests, graceful shutdown). */
  async idle() {
    await Promise.all(this.queues.values());
  }

  private findProject(ev: HookEvent) {
    const wanted = [ev.repo.name, ...ev.repo.urls].filter(Boolean).map(normalizeRepo);
    for (const p of this.o.projects.list()) {
      let origin = "";
      try {
        origin = normalizeRepo(git(p.root, ["config", "--get", "remote.origin.url"]));
      } catch {
        continue;
      }
      if (wanted.some((w) => w === origin || origin.endsWith(`/${w}`))) return p;
    }
    const url = ev.repo.urls.find((u) => /^(https:\/\/|git@|ssh:\/\/)/.test(u));
    const id = url && this.o.clone?.(url, ev.repo.name.split("/").pop() || "repo");
    return id ? this.o.projects.list().find((p) => p.id === id) : undefined;
  }

  private async process(d: Delivery, ev: HookEvent) {
    const ws = this.o.projects.get(d.projectId!).ws;
    this.save({ ...d, status: "running", message: "Running" });
    try {
      const out = ev.event === "pull_request" ? await this.pullRequest(ws, d, ev) : await this.push(ws, d, ev);
      this.save({ ...d, ...out });
    } catch (e) {
      this.save({ ...d, status: "failed", message: (e as Error).message.slice(0, 500) });
    }
  }

  private trigger(ev: HookEvent): AuditTrigger {
    return { source: "webhook", provider: ev.provider, event: ev.event, ref: ev.branch, sha: ev.sha, url: ev.pr?.url };
  }

  private async push(ws: Workspace, d: Delivery, ev: HookEvent): Promise<Partial<Delivery>> {
    const settings = ws.automation();
    if (settings.push === "off") return { status: "ignored", message: "Push scans are off for this project." };
    if (ev.deleted) return { status: "ignored", message: "The branch was deleted." };
    const branch = currentBranch(ws.root);
    if (ev.branch !== branch) return { status: "ignored", message: `Push to ${ev.branch}; this project audits ${branch}.` };
    const stateRel = relative(ws.root, ws.store.dir).split("\\").join("/");
    if (changedPaths(ws.root, stateRel).length) return { status: "skipped", message: "The working tree has uncommitted changes (a fix in progress?); not updated." };
    git(ws.root, ["fetch", "--quiet", "origin", `refs/heads/${branch}`]);
    try {
      git(ws.root, ["merge", "--ff-only", "--quiet", "FETCH_HEAD"]);
    } catch {
      return { status: "skipped", message: `${branch} cannot be fast-forwarded to the pushed commit; it has local commits (accepted fixes?). Push or reset them.` };
    }
    const provider = this.o.provider();
    const agent = settings.push === "agent" && provider;
    let audit: Audit = ws.createAudit({ mode: agent ? "agent" : "static", actor: WEBHOOK, trigger: this.trigger({ ...ev, sha: head(ws.root) }) });
    let note = "";
    if (agent) {
      const job = this.o.jobs.start({ kind: "investigate", projectId: d.projectId!, auditId: audit.id, title: `Automatic audit of ${head(ws.root).slice(0, 7)}` }, async ({ signal, emit }) => {
        if (!ws.project().classification?.purpose) await understandProduct(ws, { provider, signal, onEvent: emit });
        return investigate(ws, audit.id, { provider, signal, onEvent: emit });
      });
      const done = await this.o.jobs.wait(job.id);
      if (done?.status !== "done") note = ` The agent audit ${done?.status ?? "failed"}${done?.error ? `: ${done.error}` : ""}.`;
      audit = ws.getAudit(audit.id);
    } else if (settings.push === "agent") note = " No model is configured, so only the detectors ran.";
    const s = summarize(audit.findings);
    const g = gate(audit, settings.failOn);
    const reported = await this.reportPush(ws, d, ev, audit, g.blocking.length);
    return {
      status: "done",
      message: `${agent ? "Agent audit" : "Scan"}: ${s.total} findings, ${g.blocking.length} open at ${settings.failOn} or above.${note}`,
      auditId: audit.id,
      sha: head(ws.root),
      summary: { total: s.total, bySeverity: s.bySeverity },
      reported,
    };
  }

  private async pullRequest(ws: Workspace, d: Delivery, ev: HookEvent): Promise<Partial<Delivery>> {
    const settings = ws.automation();
    if (settings.pullRequest === "off") return { status: "ignored", message: "Pull request scans are off for this project." };
    const n = ev.pr!.number;
    const ref = `refs/acai/pr-${n}`;
    const source = ev.provider === "github" ? `refs/pull/${n}/head` : ev.provider === "gitlab" ? `refs/merge-requests/${n}/head` : ev.pr!.headSha;
    git(ws.root, ["fetch", "--quiet", "origin", `+${source}:${ref}`]);
    const dir = mkdtempSync(join(tmpdir(), "acai-pr-"));
    let findings: Omit<Finding, "id">[];
    try {
      try {
        git(ws.root, ["worktree", "add", "--quiet", "--detach", dir, ref]);
      } catch {
        // Shared file systems (Docker Desktop mounts) can serve a just-written object stale; retry once.
        await new Promise((r) => setTimeout(r, 1000));
        rmSync(dir, { recursive: true, force: true });
        git(ws.root, ["worktree", "prune"]);
        git(ws.root, ["worktree", "add", "--quiet", "--detach", dir, ref]);
      }
      const snapshot = scanProject(dir);
      findings = staticAudit(snapshot, classify(snapshot).classification, ws.controlsInScope()).findings;
    } finally {
      try {
        git(ws.root, ["worktree", "remove", "--force", dir]);
      } catch {
        rmSync(dir, { recursive: true, force: true });
        git(ws.root, ["worktree", "prune"]);
      }
      git(ws.root, ["update-ref", "-d", ref]);
    }
    // Compare with the latest audit of the audited branch.
    const base = ws.store.latestAudit();
    const known = new Map(base?.findings.map((f) => [f.fingerprint, f]) ?? []);
    const seen = new Set(findings.map((f) => f.fingerprint));
    const added = findings.filter((f) => !known.has(f.fingerprint)).map((f, i) => ({ ...f, id: `PR-${i + 1}` }) as Finding);
    const fixed = (base?.findings ?? []).filter((f) => (f.source === "check" || f.source === "artifact") && !seen.has(f.fingerprint) && ["open", "confirmed", "fix_failed"].includes(f.status));
    const stillOpen = findings.filter((f) => ["open", "confirmed"].includes(known.get(f.fingerprint)?.status ?? "")).length;
    const blocking = added.filter((f) => sevRank(f.severity) <= sevRank(settings.failOn));
    const body = this.prComment(ws, d, added, fixed, stillOpen, blocking.length, settings.failOn);
    const reported = await this.reportPullRequest(ws, d, ev, body, blocking.length, added.length);
    return {
      status: "done",
      message: `${added.length} new finding(s), ${fixed.length} fixed, ${stillOpen} already known.${base ? "" : " The branch has no audit yet, so every finding counts as new."}`,
      pr: { number: n, added: added.length, fixed: fixed.length, known: stillOpen, url: ev.pr?.url },
      reported,
    };
  }

  private dashboardLink(projectId: string, tab = "findings") {
    return this.o.publicUrl ? `${this.o.publicUrl}/#/p/${encodeURIComponent(projectId)}/${tab}` : undefined;
  }

  prComment(ws: Workspace, d: Delivery, added: Finding[], fixed: Finding[], known: number, blocking: number, failOn: Severity) {
    const lines = [MARKER, "### ◆ Acai compliance check", ""];
    lines.push(
      added.length
        ? `This pull request adds **${added.length} finding(s)**${blocking ? `, ${blocking} at ${failOn} or above` : ""}.`
        : "This pull request adds no new findings.",
    );
    if (fixed.length) lines.push(`It fixes ${fixed.length}: ${fixed.map((f) => `${f.id} ${f.title}`).join("; ")}.`);
    if (known) lines.push(`${known} known finding(s) on the base branch are still open.`);
    if (added.length) {
      lines.push("", "| Severity | Finding | Where |", "| --- | --- | --- |");
      for (const f of added.slice(0, 30)) lines.push(`| ${f.severity} | ${f.title.replace(/\|/g, "\\|")} | ${f.locations.slice(0, 2).map((l) => `\`${l.path}${l.line ? `:${l.line}` : ""}\``).join(", ")} |`);
      lines.push("", "<details><summary>Instructions for your coding agent (Claude Code, Codex, Copilot, Cursor…)</summary>", "");
      lines.push(tasksMarkdown(ws, findingTasks(ws, added), { heading: `Fix what pull request #${d.event.replace(/\D/g, "")} adds` }).replace(/^# /m, "#### "));
      lines.push("", "</details>");
    }
    const link = d.projectId && this.dashboardLink(d.projectId);
    if (link) lines.push("", `[Open the project in Acai](${link})`);
    return lines.join("\n");
  }

  // ------------------------------------------------------------------ GitHub
  private async github(method: string, path: string, body?: unknown) {
    const base = (process.env.ACAI_GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "acai", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 ? undefined : res.json();
  }

  private async status(ev: HookEvent, sha: string, failed: boolean, description: string, projectId: string) {
    await this.github("POST", `/repos/${ev.repo.name}/statuses/${sha}`, {
      state: failed ? "failure" : "success",
      context: "acai/compliance",
      description: description.slice(0, 140),
      target_url: this.dashboardLink(projectId),
    });
  }

  private async reportPush(ws: Workspace, d: Delivery, ev: HookEvent, audit: Audit, blocking: number): Promise<string[]> {
    const s = ws.automation();
    if (ev.provider !== "github" || !process.env.GITHUB_TOKEN || !s.report.commitStatus) return [];
    const sum = summarize(audit.findings);
    try {
      await this.status(ev, head(ws.root), blocking > 0, blocking ? `${blocking} open finding(s) at ${s.failOn} or above, ${sum.total} in total` : `No open findings at ${s.failOn} or above`, d.projectId!);
      return ["commit status"];
    } catch (e) {
      return [`commit status failed: ${(e as Error).message}`];
    }
  }

  private async reportPullRequest(ws: Workspace, d: Delivery, ev: HookEvent, body: string, blocking: number, added: number): Promise<string[]> {
    const s = ws.automation();
    if (ev.provider !== "github" || !process.env.GITHUB_TOKEN) return [];
    const done: string[] = [];
    if (s.report.commitStatus)
      try {
        await this.status(ev, ev.pr!.headSha, blocking > 0, added ? `${added} new finding(s), ${blocking} at ${s.failOn} or above` : "No new findings", d.projectId!);
        done.push("commit status");
      } catch (e) {
        done.push(`commit status failed: ${(e as Error).message}`);
      }
    if (s.report.prComment)
      try {
        // One comment per pull request, updated on every push.
        const comments = (await this.github("GET", `/repos/${ev.repo.name}/issues/${ev.pr!.number}/comments?per_page=100`)) as { id: number; body?: string }[];
        const mine = comments.find((c) => c.body?.includes(MARKER));
        if (mine) await this.github("PATCH", `/repos/${ev.repo.name}/issues/comments/${mine.id}`, { body });
        else await this.github("POST", `/repos/${ev.repo.name}/issues/${ev.pr!.number}/comments`, { body });
        done.push("pull request comment");
      } catch (e) {
        done.push(`comment failed: ${(e as Error).message}`);
      }
    return done;
  }
}
