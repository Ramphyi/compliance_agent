#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type Actor, createProvider, fixFinding, gate, loadRegistry, report, research, SEVERITIES, summarize, Workspace,
} from "@assay/core";
import { createMcpServer } from "./mcp";
import { Projects } from "./projects";
import { startServer } from "./server";
import { c, logo, Prompter, sev, table } from "./term";
import { auditFlow, printEvent, reviewOnly } from "./tui";

const HELP = `${logo()}

Usage: assay <command> [path] [options]

Audit
  audit [path]          Interactive audit: understand, ask, scope, audit, review, fix, report
      --preset <id>       Start from a preset answer set (see \`assay presets\`)
      --static            Detectors only, no model
      --no-fix            Stop after review
      --research          Offer web research for extra guardrails
      --yes               Non-interactive: accept suggestions, skip decisions
  review [path]         Review open findings of the latest audit in the terminal
  fix [path]            Fix confirmed findings (--finding F-001 for one)
  verify [path]         Show build/test commands; --set "make all; make test" --approve; --run
  report [path]         --format md|json|sarif  --out <file>  --audit <id>
  ci [path]             Detector audit for pipelines; exit 1 on unresolved findings
      --fail-on <sev>     critical|high|medium|low (default high)
      --sarif <file>      Also write SARIF for code scanning

Profile and rules
  scan [path]           Classify the project and draft profile answers
  profile [path]        Show answers; --set fact=value[,value] (repeatable); --confirm
  scope [path]          Frameworks that apply and why
  presets               List presets
  frameworks            List the registry
  research [path]       Web research for guardrails (Anthropic or OpenAI provider)
  journal [path]        Audit trail; --verify checks the hash chain

Run as a service
  serve [paths...]      Dashboard + API + MCP over HTTP (default http://127.0.0.1:4317)
      --port <n> --host <addr>   Non-local hosts need ASSAY_TOKEN or ASSAY_TOKENS
  mcp [path]            MCP server on stdio for Claude Code, Cursor, VS Code and others
      --dashboard         Also serve the dashboard (--port, default 4317)

Common options
  --state-dir <dir>     Where audit state lives (default <project>/.assay)

Model: ANTHROPIC_API_KEY (Claude, default claude-opus-5-5), OPENAI_API_KEY (OpenAI, default gpt-5.5),
or ASSAY_PROVIDER=openai-compatible ASSAY_OPENAI_BASE_URL=... ASSAY_MODEL=... for on-premise models.
ASSAY_MODEL overrides the model; ASSAY_PARALLEL sets parallel investigation batches (default 3).
Without a model, Assay runs detectors and an MCP host can do the reasoning.`;

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
    "fail-on": { type: "string" },
    sarif: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
    dashboard: { type: "boolean" },
    "allow-insecure": { type: "boolean" },
    "state-dir": { type: "string" },
    verify: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const [command = "help", ...rest] = positionals;
const target = resolve(rest[0] ?? ".");
const stateDir = flags["state-dir"] ? resolve(String(flags["state-dir"])) : undefined;
const me: Actor = { type: "human", name: process.env.ASSAY_USER || userInfo().username };
const open = (path = target) => Workspace.open(path, { stateDir });

async function main() {
  if (flags.version) return console.log("assay 0.1.0");
  if (flags.help || command === "help") return console.log(HELP);
  const provider = await createProvider();

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
      console.log(`\n${c.bold("Draft answers")} ${c.dim("(confirm with `assay profile --confirm` or in the dashboard)")}`);
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
    case "presets": {
      const { registry } = loadRegistry();
      for (const p of registry.presets) console.log(`${c.bold(p.id)}  ${p.title}\n  ${c.dim(p.description.trim().split("\n")[0])}`);
      return;
    }
    case "frameworks": {
      const { registry, errors } = loadRegistry();
      console.log(table(registry.frameworks.map((f) => [f.id, f.shortTitle, c.dim(f.version), c.dim(f.kind), `${f.controls.length}`])));
      console.log(c.dim(`\n${registry.frameworks.length} frameworks, ${registry.controls.size} controls, ${registry.presets.length} presets, registry ${registry.hash}${errors.length ? `, ${errors.length} errors` : ""}`));
      return;
    }
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
      console.log(c.dim("Accept or revert fixes with `assay review` or in the dashboard."));
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
    case "ci": {
      const ws = open();
      if (flags.preset && !ws.project().presetId) ws.applyPreset(String(flags.preset), { type: "system", name: "ci" });
      const unconfirmed = ws.profileView().completeness.unconfirmed;
      const audit = ws.createAudit({ mode: "static", actor: { type: "system", name: "ci" } });
      const failOn = (SEVERITIES as readonly string[]).includes(String(flags["fail-on"])) ? (flags["fail-on"] as (typeof SEVERITIES)[number]) : "high";
      const g = gate(audit, failOn);
      if (flags.sarif) writeFileSync(String(flags.sarif), report(ws, audit.id, "sarif"));
      const s = summarize(audit.findings);
      console.log(`Assay ${audit.id}: ${s.total} findings (${SEVERITIES.map((x) => `${x} ${s.bySeverity[x]}`).join(", ")})`);
      if (unconfirmed.length) console.log(`warning: profile answers not confirmed by a person: ${unconfirmed.join(", ")}`);
      for (const f of g.blocking) console.log(`${f.severity.toUpperCase()} ${f.id} ${f.title} ${f.locations[0] ? `(${f.locations[0].path}${f.locations[0].line ? `:${f.locations[0].line}` : ""})` : ""} [${f.status}]`);
      console.log(g.passed ? `PASS: no unresolved findings at ${failOn} or above` : `FAIL: ${g.blocking.length} unresolved finding(s) at ${failOn} or above`);
      process.exitCode = g.passed ? 0 : 1;
      return;
    }
    case "research": {
      const ws = open();
      if (!provider) throw new Error("Research needs a model with web search (ANTHROPIC_API_KEY or OPENAI_API_KEY), or ask your MCP host to research and call assay_propose_rules.");
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
      for (const p of rest.length ? rest : ["."]) projects.add(p);
      const host = String(flags.host ?? process.env.ASSAY_HOST ?? "127.0.0.1");
      const port = Number(flags.port ?? process.env.ASSAY_PORT ?? 4317);
      const { url } = await startServer({ projects, provider, host, port, allowInsecure: Boolean(flags["allow-insecure"]) });
      console.log(`${logo()}\nDashboard  ${c.bold(url)}\nMCP (HTTP) ${url}/mcp\nModel      ${provider ? provider.destination : c.yellow("none (detectors only; an MCP host can do the reasoning)")}`);
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
        console.error(`Assay dashboard: ${dashboard}`);
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

main().catch((e: Error) => {
  console.error(c.red(`assay: ${e.message}`));
  if (process.env.ASSAY_DEBUG) console.error(e.stack);
  process.exitCode = process.exitCode || 2;
});
