#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type Actor, createProvider, fixTasks, PROVIDER_PRESETS, tasksMarkdown, fixFinding, gate, report, research, SEVERITIES, summarize, Workspace,
  customFrameworksDir, type FrameworkCheck, FrameworkError, frameworkSource, frameworkTemplate, listFrameworks, removeFramework, saveFramework, serverRegistry, validateFramework,
} from "@acai/core";
import { AuthStore, type ChangedBy } from "./auth";
import { CLIENTS, type Client, connectInstructions, connectOverview } from "./connect";
import { createMcpServer } from "./mcp";
import { resolveProviderConfig } from "./models";
import { acaiHome, Projects } from "./projects";
import { startServer } from "./server";
import { c, logo, Prompter, sev, table } from "./term";
import { auditFlow, printEvent, reviewOnly } from "./tui";

const HELP = `${logo()}

Usage: acai <command> [path] [options]

Audit
  audit [path]          Interactive audit: understand, ask, scope, audit, review, fix, report
      --preset <id>       Start from a preset answer set (see \`acai presets\`)
      --static            Detectors only, no model
      --no-fix            Stop after review
      --research          Offer web research for extra guardrails
      --yes               Non-interactive: accept suggestions, skip decisions
  review [path]         Review open findings of the latest audit in the terminal
  fix [path]            Fix confirmed findings (--finding F-001 for one)
  verify [path]         Show build/test commands; --set "make all; make test" --approve; --run
  report [path]         --format md|json|sarif  --out <file>  --audit <id>
  tasks [path]          The findings as instructions for a coding agent (Claude Code, Codex, Copilot,
                        Cursor…): --status confirmed,open  --finding F-001  --out TASKS.md  --json
  ci [path]             Detector audit for pipelines; exit 1 on unresolved findings
      --fail-on <sev>     critical|high|medium|low (default high)
      --sarif <file>      Also write SARIF for code scanning

Profile and rules
  scan [path]           Classify the project and draft profile answers
  profile [path]        Show answers; --set fact=value[,value] (repeatable); --confirm
  scope [path]          Frameworks that apply and why
  presets               List presets
  providers             Model providers for Acai's own agents, and how to select one
  frameworks            List the registry (built-in, and this server's own frameworks)
  frameworks add <file.yaml>   Add a framework for every project, or update a built-in one by
                        reusing its id (a newer ISO revision, an internal standard). - reads stdin
  frameworks validate <file>   Check a file without saving it
  frameworks show <id>  Print a framework's YAML: the starting point for an update
  frameworks remove <id>  Remove one of this server's frameworks (a replaced built-in comes back)
  frameworks template   Print a template for a new framework
  research [path]       Web research for guardrails (Anthropic or OpenAI provider)
  journal [path]        Audit trail; --verify checks the hash chain

Run as a service
  serve [paths...]      Dashboard + API + MCP over HTTP (default http://127.0.0.1:4317)
      --port <n> --host <addr>   Non-local hosts need accounts (ACAI_ADMIN_TOKEN or \`acai users add\`)
  mcp [path]            MCP server on stdio for Claude Code, Codex, Cursor, VS Code and others
      --dashboard         Also serve the dashboard (--port, default 4317)
  connect [client] [path]  Show how to add Acai to an MCP client (claude-code, codex, cursor,
                        vscode, claude-desktop, gemini, windsurf, chatgpt, claude-ai, openai-api,
                        anthropic-api, agent-sdk)
      --url <url>         Connect to a running \`acai serve\` (https://host/mcp) instead of stdio

Accounts for a shared server (in $ACAI_HOME/auth.json; a running server applies changes at once)
  users [list]          Accounts, roles and when they were last seen
  users add <name>      Create an account and print its first API token once
      --role <role>       admin, member (default) or viewer
  users set <name>      --role <role> | --disable | --enable | --rename <new name>
  users remove <name>   Delete an account with its tokens and sessions
  tokens [list] [user]  API tokens (only prefixes are shown)
  tokens create <user>  New API token: --label <text> --expires <days>d
  tokens revoke <id>    Revoke by id or prefix; ends the sessions opened with it
  In Docker: docker compose exec acai node /opt/acai/acai.mjs users list

Common options
  --state-dir <dir>     Where audit state lives (default <project>/.acai)

Model: choose it on the dashboard's Model page, or set ANTHROPIC_API_KEY (Claude) or OPENAI_API_KEY (GPT),
or ACAI_PROVIDER=<provider> ACAI_MODEL=<model> with that provider's key: \`acai providers\` lists them
(Gemini, OpenRouter, Mistral, Groq, DeepSeek, xAI, Together, Microsoft Foundry on Azure, Ollama, LM Studio,
any OpenAI-compatible URL).
ACAI_PARALLEL sets parallel investigation batches (default 3).
Without a model, Acai runs detectors and an MCP host can do the reasoning.`;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    preset: { type: "string" },
    static: { type: "boolean" },
    "no-fix": { type: "boolean" },
    research: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    finding: { type: "string" },
    set: { type: "string", multiple: true },
    approve: { type: "boolean" },
    run: { type: "boolean" },
    confirm: { type: "boolean" },
    format: { type: "string" },
    out: { type: "string" },
    audit: { type: "string" },
    status: { type: "string" },
    "fail-on": { type: "string" },
    sarif: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    url: { type: "string" },
    dashboard: { type: "boolean" },
    "allow-insecure": { type: "boolean" },
    "state-dir": { type: "string" },
    verify: { type: "boolean" },
    json: { type: "boolean" },
    role: { type: "string" },
    disable: { type: "boolean" },
    enable: { type: "boolean" },
    rename: { type: "string" },
    label: { type: "string" },
    expires: { type: "string" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const [command = "help", ...rest] = positionals;
const target = resolve(rest[0] ?? ".");
const stateDir = flags["state-dir"] ? resolve(String(flags["state-dir"])) : undefined;
const me: Actor = { type: "human", name: process.env.ACAI_USER || userInfo().username };
const open = (path = target) => Workspace.open(path, { stateDir });

/**
 * A repository is served as one project; a folder of repositories (such as the container's
 * /workspace) serves each one. An empty folder serves nothing: add projects in the dashboard.
 */
function projectDirs(path: string): string[] {
  const abs = resolve(path);
  if (existsSync(join(abs, ".git"))) return [abs];
  const entries = readdirSync(abs, { withFileTypes: true }).filter((d) => !d.name.startsWith("."));
  const repos = entries.filter((d) => d.isDirectory() && existsSync(join(abs, d.name, ".git"))).map((d) => join(abs, d.name));
  return repos.length ? repos : entries.length ? [abs] : [];
}

const when = (at?: string) => (at ? at.slice(0, 16).replace("T", " ") : "-");

/** `acai users ...` and `acai tokens ...`: edit $ACAI_HOME/auth.json directly (also inside the container). */
function accounts(kind: "users" | "tokens", args: string[]) {
  const store = new AuthStore({ file: join(acaiHome(), "auth.json") });
  const by: ChangedBy = { name: `${process.env.ACAI_USER || userInfo().username} (cli)` };
  const [sub = "list", arg] = args;
  const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  const applied = () => console.log(c.dim(`Saved in ${store.file}. A running server applies it without a restart.`));
  const need = (usage: string) => {
    if (!arg) throw new Error(`Usage: ${usage}`);
    return arg;
  };
  if (kind === "users") {
    switch (sub) {
      case "list": {
        const users = store.listUsers();
        if (flags.json) return print(users);
        if (!users.length) return console.log("No accounts yet. Create the first administrator with `acai users add <name> --role admin`, or set ACAI_ADMIN_TOKEN.");
        console.log(table([["NAME", "ROLE", "STATUS", "SOURCE", "TOKENS", "SESSIONS", "LAST SEEN"].map(c.dim), ...users.map((u) => [u.name, u.role, u.disabled ? c.red("disabled") : c.green("enabled"), u.source, String(u.tokens), String(u.sessions), when(u.lastSeenAt)])]));
        return;
      }
      case "add": {
        const { user, token } = store.createUser({ name: need("acai users add <name> [--role admin|member|viewer]"), role: flags.role ?? "member" }, by);
        if (flags.json) return print({ user, token });
        console.log(`Created ${c.bold(user.name)} (${user.role}). API token, shown only this once:\n\n  ${token}\n`);
        console.log(c.dim("Sign in to the dashboard with it, or send it as `Authorization: Bearer <token>` from API and MCP clients."));
        return applied();
      }
      case "set": {
        const name = need("acai users set <name> --role <role> | --disable | --enable | --rename <new name>");
        const patch: { role?: unknown; disabled?: boolean; name?: unknown } = {};
        if (flags.role !== undefined) patch.role = flags.role;
        if (flags.disable) patch.disabled = true;
        if (flags.enable) patch.disabled = false;
        if (flags.rename !== undefined) patch.name = flags.rename;
        if (!Object.keys(patch).length) throw new Error("Nothing to change: use --role <role>, --disable, --enable or --rename <new name>.");
        const u = store.updateUser(store.user(name).id, patch, by);
        if (flags.json) return print(u);
        console.log(`${c.bold(u.name)}: ${u.role}, ${u.disabled ? "disabled" : "enabled"}`);
        return applied();
      }
      case "remove":
      case "rm":
      case "delete": {
        const u = store.user(need("acai users remove <name>"));
        store.deleteUser(u.id, by);
        console.log(`Deleted ${c.bold(u.name)} with its tokens and sessions.`);
        return applied();
      }
      default:
        throw new Error(`Unknown subcommand "${sub}". Use: acai users list | add | set | remove`);
    }
  }
  switch (sub) {
    case "list": {
      const tokens = store.listTokens(arg ? store.user(arg).id : undefined);
      if (flags.json) return print(tokens);
      if (!tokens.length) return console.log("No API tokens.");
      const now = Date.now();
      console.log(
        table([
          ["ID", "USER", "LABEL", "PREFIX", "CREATED", "LAST USED", "EXPIRES"].map(c.dim),
          ...tokens.map((t) => [t.id, t.userName, t.label, t.prefix || "-", when(t.createdAt), when(t.lastUsedAt), t.expiresAt ? (Date.parse(t.expiresAt) <= now ? c.red("expired") : when(t.expiresAt)) : "never"]),
        ]),
      );
      return;
    }
    case "create": {
      const user = store.user(need("acai tokens create <user> [--label <text>] [--expires 90d]"));
      const days = flags.expires === undefined ? undefined : /^\s*(\d+)\s*d?\s*$/i.exec(String(flags.expires))?.[1];
      if (flags.expires !== undefined && !days) throw new Error("--expires takes a number of days, for example 90d");
      const { token, info } = store.createToken(user.id, { label: flags.label, expiresInDays: days }, by);
      if (flags.json) return print({ token, info });
      console.log(`New token ${c.bold(info.id)} for ${c.bold(info.userName)}${info.expiresAt ? `, expires ${when(info.expiresAt)}` : ""}. Shown only this once:\n\n  ${token}\n`);
      return applied();
    }
    case "revoke":
    case "rm":
    case "delete": {
      const info = store.revokeToken(need("acai tokens revoke <id-or-prefix>"), by);
      console.log(`Revoked ${c.bold(info.id)} (${info.userName}, ${info.label}). Sessions and OAuth connectors that used it no longer work.`);
      return applied();
    }
    default:
      throw new Error(`Unknown subcommand "${sub}". Use: acai tokens list | create | revoke`);
  }
}

async function main() {
  if (flags.version) return console.log("acai 0.1.0");
  if (flags.help || command === "help") return console.log(HELP);
  if (command === "users" || command === "tokens") return accounts(command, rest);
  if (command === "connect") {
    const [client, path = "."] = rest;
    const opts = { project: resolve(path), url: flags.url ? String(flags.url) : undefined };
    if (!client) return console.log(connectOverview(opts));
    if (!(CLIENTS as readonly string[]).includes(client)) throw new Error(`Unknown client "${client}". Clients: ${CLIENTS.join(", ")}`);
    return console.log(connectInstructions(client as Client, opts));
  }
  // Services start without a model if its settings are broken, so it can be fixed in the dashboard.
  let provider: Awaited<ReturnType<typeof createProvider>> = null;
  let providerError: string | undefined;
  try {
    provider = await createProvider(resolveProviderConfig().config);
  } catch (e) {
    if (command !== "serve" && command !== "mcp") throw e;
    providerError = (e as Error).message;
    console.error(c.yellow(`acai: model not available: ${providerError}`));
  }

  switch (command) {
    case "audit": {
      console.log(logo());
      await auditFlow(open(), {
        preset: flags.preset as string | undefined,
        agent: !flags.static,
        fix: !flags["no-fix"],
        research: Boolean(flags.research),
        assumeYes: Boolean(flags.yes),
        provider: flags.static ? null : provider,
        actor: me,
      });
      return;
    }
    case "init": {
      const ws = open();
      ws.init();
      console.log(`Initialised ${ws.store.dir}`);
      return;
    }
    case "scan": {
      const ws = open();
      const v = ws.refreshProfile(me);
      if (flags.json) return console.log(JSON.stringify(v, null, 2));
      console.log(`${c.bold(v.classification?.summary ?? "")}\n`);
      for (const s of v.classification?.signals ?? []) console.log(`${c.teal("·")} ${s.label} ${c.dim(s.refs.slice(0, 2).map((r) => `${r.path}${r.line ? `:${r.line}` : ""}`).join(", "))}`);
      console.log(`\n${c.bold("Draft answers")} ${c.dim("(confirm with `acai profile --confirm` or in the dashboard)")}`);
      for (const q of v.questions.filter((x) => x.answer)) console.log(`  ${q.id}: ${[q.answer!.value].flat().join(", ")} ${q.answer!.confirmed ? c.green("confirmed") : c.dim(q.answer!.source)}`);
      return;
    }
    case "profile": {
      const ws = open();
      for (const s of (flags.set as string[] | undefined) ?? []) {
        const [k, v] = s.split("=");
        const q = ws.registry.questionnaire.questions.find((x) => x.id === k);
        if (!q || v === undefined) throw new Error(`Use --set fact=value. Unknown fact "${k}".`);
        ws.setAnswers({ [k]: q.type === "multi" ? v.split(",") : v }, me);
      }
      if (flags.confirm) ws.confirmAnswers("all", me);
      const v = ws.profileView();
      console.log(table(v.questions.map((q) => [q.id, q.answer ? [q.answer.value].flat().join(", ") : c.dim("—"), q.answer?.confirmed ? c.green("confirmed") : q.answer ? c.yellow(q.answer.source) : ""])));
      return;
    }
    case "scope": {
      const ws = open();
      console.log(table(ws.scopeView().map((s) => [s.active ? c.teal("●") : s.status === "unknown" ? c.yellow("?") : c.dim("○"), s.shortTitle, c.dim(s.version), s.status === "unknown" ? c.yellow(`needs ${s.missingFacts.join(", ")}`) : c.dim(s.override ? `${s.override}d` : s.status)])));
      return;
    }
    case "providers": {
      const { config, source } = resolveProviderConfig();
      console.log(table(PROVIDER_PRESETS.map((p) => [config.preset === p.id ? c.teal("●") : " ", p.id, p.label, c.dim(p.keyEnv ? `${p.keyEnv}${process.env[p.keyEnv] ? " (set)" : ""}` : "no key"), c.dim(p.baseURL ?? "")])));
      console.log(c.dim(`\nActive: ${provider?.destination ?? "none"} (from ${source}). Select with ACAI_PROVIDER=<id> ACAI_MODEL=<model>, or on the dashboard's Model page.`));
      return;
    }
    case "presets": {
      const { registry } = serverRegistry();
      for (const p of registry.presets) console.log(`${c.bold(p.id)}  ${p.title}\n  ${c.dim(p.description.trim().split("\n")[0])}`);
      return;
    }
    case "frameworks":
      return frameworks(rest);
    case "review": {
      const ws = open();
      await reviewOnly(ws, ws.getAudit(flags.audit as string | undefined).id, provider, me);
      return;
    }
    case "fix": {
      const ws = open();
      if (!provider) throw new Error("Fixing needs a model provider (ANTHROPIC_API_KEY), or use an MCP host such as Claude Code.");
      const audit = ws.getAudit(flags.audit as string | undefined);
      const ids = flags.finding ? [String(flags.finding)] : audit.findings.filter((f) => f.status === "confirmed" && f.fixability !== "process").map((f) => f.id);
      if (!ids.length) return console.log("No confirmed findings to fix.");
      for (const id of ids) {
        console.log(`${c.bold(`Fixing ${id}`)}`);
        const f = await fixFinding(ws, audit.id, id, { provider, onEvent: printEvent });
        console.log(f.status === "fix_ready" ? c.green(`  ✓ ${f.fix?.commit?.slice(0, 8)} on ${f.fix?.branch}`) : c.red(`  ✗ ${f.status}: ${f.fix?.error ?? ""}`));
      }
      console.log(c.dim("Accept or revert fixes with `acai review` or in the dashboard."));
      return;
    }
    case "verify": {
      const ws = open();
      if (flags.set) ws.setVerify(String(([flags.set].flat() as string[])[0]).split(";").map((x) => x.trim()).filter(Boolean), { approve: Boolean(flags.approve) }, me);
      else if (flags.approve) ws.setVerify(ws.verifyConfig().commands, { approve: true }, me);
      const v = ws.verifyConfig();
      console.log(`${v.approved ? c.green("approved") : c.yellow("not approved")}: ${v.commands.join(" && ") || "(none)"}`);
      if (flags.run) {
        for (const r of await ws.runVerify()) console.log(`${r.passed ? c.green("PASS") : c.red("FAIL")} ${r.command} ${c.dim(`${r.durationMs} ms`)}${r.passed ? "" : `\n${r.output.slice(-3000)}`}`);
      }
      return;
    }
    case "report": {
      const ws = open();
      const fmt = (flags.format as "md" | "json" | "sarif") ?? "md";
      const out = report(ws, flags.audit as string | undefined, fmt);
      if (flags.out) {
        writeFileSync(String(flags.out), out);
        console.log(`Wrote ${flags.out}`);
      } else console.log(out);
      return;
    }
    case "tasks": {
      const ws = open();
      const audit = ws.getAudit(flags.audit as string | undefined);
      const statuses = String(flags.status ?? "confirmed").split(",") as never;
      const tasks = fixTasks(ws, audit.id, { statuses, ids: flags.finding ? [String(flags.finding)] : undefined });
      const out = flags.json ? JSON.stringify(tasks, null, 2) : tasksMarkdown(ws, tasks, { auditId: audit.id });
      if (flags.out) {
        writeFileSync(String(flags.out), out);
        console.log(`Wrote ${tasks.length} task(s) to ${flags.out}`);
      } else console.log(out);
      return;
    }
    case "ci": {
      const ws = open();
      if (flags.preset && !ws.project().presetId) ws.applyPreset(String(flags.preset), { type: "system", name: "ci" });
      const unconfirmed = ws.profileView().completeness.unconfirmed;
      const audit = ws.createAudit({ mode: "static", actor: { type: "system", name: "ci" } });
      const failOn = (SEVERITIES as readonly string[]).includes(String(flags["fail-on"])) ? (flags["fail-on"] as (typeof SEVERITIES)[number]) : "high";
      const g = gate(audit, failOn);
      if (flags.sarif) writeFileSync(String(flags.sarif), report(ws, audit.id, "sarif"));
      const s = summarize(audit.findings);
      console.log(`Acai ${audit.id}: ${s.total} findings (${SEVERITIES.map((x) => `${x} ${s.bySeverity[x]}`).join(", ")})`);
      if (unconfirmed.length) console.log(`warning: profile answers not confirmed by a person: ${unconfirmed.join(", ")}`);
      for (const f of g.blocking) console.log(`${f.severity.toUpperCase()} ${f.id} ${f.title} ${f.locations[0] ? `(${f.locations[0].path}${f.locations[0].line ? `:${f.locations[0].line}` : ""})` : ""} [${f.status}]`);
      console.log(g.passed ? `PASS: no unresolved findings at ${failOn} or above` : `FAIL: ${g.blocking.length} unresolved finding(s) at ${failOn} or above`);
      process.exitCode = g.passed ? 0 : 1;
      return;
    }
    case "research": {
      const ws = open();
      if (!provider) throw new Error("Research needs a model with web search (ANTHROPIC_API_KEY or OPENAI_API_KEY), or ask your MCP host to research and call acai_propose_rules.");
      const r = await research(ws, { provider, onEvent: printEvent });
      const p = new Prompter(Boolean(flags.yes));
      for (const rule of ws.store.readResearch().filter((x) => r.proposed.includes(x.id))) {
        console.log(`\n${c.bold(rule.id)} ${sev(rule.severity)} ${rule.title}\n${rule.requirement}\n${c.dim(rule.sources.map((s) => s.url).join(" "))}`);
        if (!flags.yes) ws.decideRule(rule.id, (await p.yes("Accept?", false)) ? "accepted" : "rejected", me);
      }
      p.close();
      return;
    }
    case "journal": {
      const ws = open();
      if (flags.verify) {
        const v = ws.store.verifyJournal();
        console.log(v.ok ? c.green(`Hash chain intact (${v.entries} entries)`) : c.red(`Hash chain BROKEN at entry ${v.brokenAt}`));
        process.exitCode = v.ok ? 0 : 1;
        return;
      }
      for (const e of ws.journal(200)) console.log(`${c.dim(e.at.slice(0, 19).replace("T", " "))} ${e.actor.type === "human" ? c.teal(e.actor.name) : c.dim(e.actor.name)} ${e.action} ${e.target ?? ""}`);
      return;
    }
    case "serve": {
      const projects = new Projects({ stateDir });
      for (const p of rest.length ? rest : ["."]) for (const dir of projectDirs(p)) projects.add(dir);
      const host = String(flags.host ?? process.env.ACAI_HOST ?? "127.0.0.1");
      const port = Number(flags.port ?? process.env.ACAI_PORT ?? 4317);
      const { url, oauth, authMode, auth } = await startServer({ projects, provider, providerError, host, port, allowInsecure: Boolean(flags["allow-insecure"]) });
      const publicUrl = process.env.ACAI_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined;
      const accountCount = auth.listUsers().length;
      console.log(`${logo()}\nDashboard  ${c.bold(url)}\nMCP (HTTP) ${publicUrl ?? url}/mcp${oauth ? c.dim("  (OAuth on: ChatGPT and Claude.ai connectors can sign in)") : ""}\nSign-in    ${authMode === "tokens" ? `API tokens (${accountCount} account${accountCount === 1 ? "" : "s"}, ${auth.file})` : c.dim("none: local use only")}\nModel      ${provider ? provider.destination : c.yellow("none (detectors only; an MCP host can do the reasoning)")}`);
      console.log(c.dim(`Projects   ${projects.list().map((p) => p.root).join(", ")}`));
      return;
    }
    case "mcp": {
      // stdout carries the MCP protocol: everything else goes to stderr.
      console.log = (...a: unknown[]) => console.error(...a);
      const projects = new Projects({ stateDir, persist: false });
      const entry = projects.add(target);
      let dashboard: string | undefined;
      if (flags.dashboard) {
        try {
          const { url } = await startServer({ projects, provider, host: "127.0.0.1", port: Number(flags.port ?? 4317) });
          dashboard = url;
        } catch {
          const { url } = await startServer({ projects, provider, host: "127.0.0.1", port: 0 });
          dashboard = url;
        }
        console.error(`Acai dashboard: ${dashboard}`);
      }
      const server = createMcpServer({ projects, defaultProject: entry.id, dashboardUrl: () => dashboard });
      await server.connect(new StdioServerTransport());
      return;
    }
    default:
      console.error(`Unknown command "${command}".\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

/** `acai frameworks ...`: the server's own frameworks in customFrameworksDir(); a running server applies changes at once. */
function frameworks([sub = "list", arg]: string[]) {
  const read = (file?: string) => {
    if (!file) throw new Error(`Usage: acai frameworks ${sub} <file.yaml>`);
    return readFileSync(file === "-" ? 0 : file, "utf8");
  };
  const show = (check: FrameworkCheck) => {
    for (const e of check.errors) console.log(c.red(`  ✗ ${e}`));
    for (const w of check.warnings) console.log(c.yellow(`  ! ${w}`));
  };
  const what = (check: FrameworkCheck) => {
    const f = check.framework!;
    return `${c.bold(f.id)} ${f.shortTitle}, ${f.version}, ${f.controls} control${f.controls === 1 ? "" : "s"}${check.replaces ? c.dim(` (replaces the ${check.replaces.origin} version ${check.replaces.version})`) : ""}`;
  };
  switch (sub) {
    case "list": {
      const { frameworks: list, errors } = listFrameworks();
      const { registry } = serverRegistry();
      const origin = (f: (typeof list)[number]) => (f.origin === "built-in" ? c.dim("built-in") : c.teal(f.replaces ? "updated" : "custom"));
      console.log(table(list.map((f) => [f.id, f.shortTitle, c.dim(f.version), c.dim(f.kind), `${f.controls}`, origin(f)])));
      for (const e of errors) console.log(c.red(`✗ ${e.file}: ${e.message}`));
      console.log(c.dim(`\n${list.length} frameworks, ${registry.controls.size} controls, ${registry.presets.length} presets, registry ${registry.hash}. This server's frameworks: ${customFrameworksDir()}`));
      return;
    }
    case "validate": {
      const check = validateFramework(read(arg));
      if (check.framework) console.log(what(check));
      show(check);
      console.log(check.ok ? c.green("✓ valid") : c.red("✗ not valid"));
      process.exitCode = check.ok ? 0 : 1;
      return;
    }
    case "add": {
      try {
        const saved = saveFramework(read(arg));
        show({ ...saved, errors: [] });
        console.log(c.green(`✓ ${saved.replaces ? "Updated" : "Added"} ${what(saved)}`));
        console.log(c.dim(`  ${saved.file}. A running server applies it to every project; re-audit to check against it.`));
      } catch (e) {
        if (!(e instanceof FrameworkError)) throw e;
        show(e.check);
        console.log(c.red("✗ not saved"));
        process.exitCode = 1;
      }
      return;
    }
    case "show":
      if (!arg) throw new Error("Usage: acai frameworks show <id>");
      process.stdout.write(frameworkSource(arg).yaml);
      return;
    case "remove": {
      if (!arg) throw new Error("Usage: acai frameworks remove <id>");
      const { restored } = removeFramework(arg);
      console.log(c.green(`✓ Removed ${arg}`) + (restored ? c.dim(` (the built-in version ${restored.version} applies again)`) : ""));
      return;
    }
    case "template":
      process.stdout.write(frameworkTemplate());
      return;
    default:
      throw new Error(`Unknown subcommand "frameworks ${sub}". Use list, add, validate, show, remove or template.`);
  }
}

main().catch((e: Error) => {
  console.error(c.red(`acai: ${e.message}`));
  if (process.env.ACAI_DEBUG) console.error(e.stack);
  process.exitCode = process.exitCode || 2;
});
