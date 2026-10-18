import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Actor, type AgentEvent, CATEGORY_LABELS, fixFinding, investigate, isGitRepo, type LlmProvider, reinvestigate,
  report, research, summarize, understandProduct, type Workspace,
} from "@assay/core";
import { c, Prompter, sev, table } from "./term";

export type AuditFlowOptions = {
  preset?: string;
  agent: boolean;
  fix: boolean;
  research: boolean;
  assumeYes: boolean;
  provider: LlmProvider | null;
  actor: Actor;
};

export function printEvent(e: AgentEvent & { stage?: string }) {
  if (e.type === "tool") {
    const input = e.input as Record<string, unknown>;
    const arg = String(input.path ?? input.pattern ?? input.glob ?? input.title ?? input.finding_id ?? input.control_id ?? input.fact ?? "");
    console.log(c.dim(`   ${e.isError ? c.red("✗") : "·"} ${e.name}${arg ? ` ${arg.slice(0, 90)}` : ""}`));
  } else if (e.type === "search") console.log(c.dim(`   ⌕ ${e.query}`));
  else if (e.type === "notice") console.log(c.cyan(`   ${e.message}`));
  else if (e.type === "text" && e.text.length < 600) console.log(c.dim(`   ${e.text.trim().split("\n").join("\n   ")}`));
}

const where = (f: { locations: { path: string; line?: number }[] }) =>
  f.locations.slice(0, 3).map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`).join(", ") + (f.locations.length > 3 ? ` +${f.locations.length - 3}` : "");

async function askQuestions(ws: Workspace, p: Prompter, actor: Actor) {
  const view = ws.profileView();
  const pending = view.questions.filter((q) => !q.answer?.confirmed);
  if (!pending.length) return;
  console.log(`\n${c.bold("Compliance questions")} ${c.dim("(Enter keeps the suggestion; numbers or values separated by commas)")}`);
  const values: Record<string, string | string[]> = {};
  for (const q of pending) {
    const current = q.answer?.value;
    console.log(`\n${c.bold(q.text)} ${c.dim(`(${q.id})`)}\n${c.dim(q.why)}`);
    (q.options ?? []).forEach((o, i) => console.log(`  ${c.dim(String(i + 1).padStart(2))} ${o.label} ${c.dim(o.value)}`));
    if (q.answer?.rationale) console.log(c.dim(`  suggested because: ${q.answer.rationale}`));
    const def = current === undefined ? "" : Array.isArray(current) ? current.join(",") : String(current);
    const raw = await p.ask(q.type === "multi" ? "Choose one or more:" : "Choose:", def);
    if (!raw) continue;
    const picks = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => (/^\d+$/.test(x) && q.options?.[Number(x) - 1] ? q.options[Number(x) - 1].value : x));
    values[q.id] = q.type === "multi" ? picks : picks[0];
  }
  if (Object.keys(values).length) ws.setAnswers(values, actor, { confirm: true });
}

function printScope(ws: Workspace) {
  const scope = ws.scopeView();
  const active = scope.filter((s) => s.active);
  console.log(`\n${c.bold("Frameworks in scope")} (${active.length})`);
  console.log(table(active.map((s) => [c.teal("●"), s.shortTitle, c.dim(s.version), c.dim(`${s.controls} controls`), c.dim(s.kind)])));
  const unknown = scope.filter((s) => s.status === "unknown" && !s.override);
  if (unknown.length) console.log(c.yellow(`\nUndecided (answer ${[...new Set(unknown.flatMap((s) => s.missingFacts))].join(", ")}): `) + unknown.map((s) => s.shortTitle).join(", "));
}

async function reviewLoop(ws: Workspace, auditId: string, p: Prompter, opts: AuditFlowOptions) {
  if (opts.assumeYes) {
    console.log(c.dim("Non-interactive run: findings stay open for a person to review (`assay review` or the dashboard)."));
    return;
  }
  for (;;) {
    const audit = ws.getAudit(auditId);
    const open = audit.findings.filter((f) => f.status === "open");
    if (!open.length) break;
    console.log(`\n${c.bold(`Review ${open.length} finding(s)`)} ${c.dim("— c confirm · r reject · m modify · i re-investigate · s skip · q stop reviewing")}`);
    let stop = false;
    for (const f of open) {
      console.log(`\n${c.bold(f.id)} ${sev(f.severity)} ${c.bold(f.title)}`);
      console.log(c.dim(`${CATEGORY_LABELS[f.category]} · ${f.source} · confidence ${f.confidence}${f.locations.length ? ` · ${where(f)}` : ""}`));
      console.log(f.description);
      for (const l of f.locations.slice(0, 3)) if (l.excerpt) console.log(c.dim(`   ${l.path}:${l.line}  ${l.excerpt}`));
      if (f.controlIds.length) console.log(c.dim(`Controls: ${f.controlIds.slice(0, 6).map((id) => { const x = ws.registry.controls.get(id); return x ? `${x.frameworkTitle} ${x.ref}` : id; }).join(", ")}${f.controlIds.length > 6 ? " …" : ""}`));
      console.log(`${c.green("Fix:")} ${f.recommendation}`);
      for (const h of f.history.filter((x) => x.note)) console.log(c.dim(`   note (${h.by.name}): ${h.note}`));
      const a = await p.choose("Decision?", [["c", "onfirm"], ["r", "eject"], ["m", "odify"], ["i", "nvestigate"], ["s", "kip"], ["q", "uit"]], opts.assumeYes ? "s" : "s");
      if (a === "q") {
        stop = true;
        break;
      }
      if (a === "s") continue;
      if (a === "c") await ws.review(auditId, f.id, { action: "confirm" }, opts.actor);
      if (a === "r") {
        const reason = await p.choose("Reason?", [["f", "alse positive"], ["a", "ccepted risk"], ["n", "ot applicable"], ["d", "uplicate"], ["o", "ther"]], "f");
        const note = await p.ask("Note (optional):");
        const map = { f: "false-positive", a: "accepted-risk", n: "not-applicable", d: "duplicate", o: "other" } as const;
        await ws.review(auditId, f.id, { action: "reject", reason: map[reason as keyof typeof map], note: note || undefined }, opts.actor);
      }
      if (a === "m") {
        const severity = await p.ask("Severity (critical/high/medium/low/info):", f.severity);
        const fixInstructions = await p.ask("Instructions for the fix (how you want it fixed):", f.fixInstructions ?? "");
        const title = await p.ask("Title:", f.title);
        const confirm = await p.yes("Confirm it for fixing?", true);
        await ws.review(auditId, f.id, { action: "modify", changes: { severity: severity as typeof f.severity, fixInstructions: fixInstructions || undefined, title }, confirm }, opts.actor);
      }
      if (a === "i") {
        const note = await p.ask("What should the agent look at again?");
        if (!note) continue;
        await ws.review(auditId, f.id, { action: "reinvestigate", note }, opts.actor);
        if (opts.provider) {
          console.log(c.cyan(`   Re-investigating ${f.id}…`));
          const r = await reinvestigate(ws, auditId, f.id, { provider: opts.provider, onEvent: printEvent });
          console.log(`   → ${r.status}: ${r.history.at(-1)?.note ?? ""}`);
        } else console.log(c.yellow("   No model provider configured; it stays queued for an MCP host (Claude Code) or the dashboard."));
      }
    }
    if (stop || opts.assumeYes) break;
    if (!ws.getAudit(auditId).findings.some((f) => f.status === "open")) break;
    if (!(await p.yes("Some findings are still open (re-investigated or skipped). Review them again?", true))) break;
  }
}

async function fixLoop(ws: Workspace, auditId: string, p: Prompter, opts: AuditFlowOptions) {
  const confirmed = ws.getAudit(auditId).findings.filter((f) => f.status === "confirmed" && f.fixability !== "process");
  if (!confirmed.length) return;
  if (!opts.provider) {
    console.log(c.yellow(`\n${confirmed.length} confirmed finding(s) are ready to fix. No model provider is configured: fix them with an MCP host (Claude Code: "fix the confirmed Assay findings") or set ANTHROPIC_API_KEY.`));
    return;
  }
  if (!isGitRepo(ws.root)) {
    console.log(c.yellow("\nFixes need a git repository so every change can be reviewed and reverted. Run `git init && git add -A && git commit` first."));
    return;
  }
  if (!(await p.yes(`\nFix ${confirmed.length} confirmed finding(s) now? Each fix is verified and committed on a separate branch.`, !opts.assumeYes))) return;
  const v = ws.verifyConfig();
  if (!v.approved) {
    console.log(`\n${c.bold("Verification")}: the fixes are checked with the project's build and tests. These commands run project code.`);
    const cmds = (await p.ask("Commands (separate with ;):", v.commands.join("; "))).split(";").map((x) => x.trim()).filter(Boolean);
    if (cmds.length && !(await p.yes(`Approve running: ${cmds.join(" && ")}?`, false))) {
      console.log(c.yellow("Not approved; skipping fixes."));
      return;
    }
    ws.setVerify(cmds, { approve: cmds.length > 0 }, opts.actor);
  }
  for (const f of confirmed) {
    console.log(`\n${c.bold(`Fixing ${f.id}`)} ${f.title}`);
    try {
      const r = await fixFinding(ws, auditId, f.id, { provider: opts.provider, onEvent: printEvent });
      if (r.status === "fix_ready") {
        console.log(c.green(`   ✓ verified and committed ${r.fix?.commit?.slice(0, 8)} on ${r.fix?.branch}`));
        console.log(c.dim((r.fix?.diff ?? "").split("\n").slice(0, 40).join("\n")));
        const accept = await p.choose("Accept this fix?", [["a", "ccept"], ["r", "evert"], ["l", "ater"]], "l");
        if (accept === "a") await ws.review(auditId, f.id, { action: "accept-fix" }, opts.actor);
        if (accept === "r") await ws.review(auditId, f.id, { action: "revert-fix", note: "Reverted in terminal review" }, opts.actor);
      } else console.log(c.red(`   ✗ ${r.status}: ${r.fix?.error ?? ""}`));
    } catch (e) {
      console.log(c.red(`   ✗ ${(e as Error).message}`));
    }
  }
}

/** The full interactive audit: understand → ask → scope → audit → review → fix → report. */
export async function auditFlow(ws: Workspace, opts: AuditFlowOptions) {
  const p = new Prompter(opts.assumeYes);
  try {
    console.log(c.dim(`Project ${ws.root}`));
    const view = ws.refreshProfile(opts.actor);
    console.log(`\n${c.bold("What this looks like")}: ${view.classification?.summary}`);
    for (const s of view.classification?.signals.slice(0, 10) ?? []) console.log(c.dim(`  · ${s.label} — ${s.refs[0]?.path}${s.refs[0]?.line ? `:${s.refs[0].line}` : ""}`));

    if (opts.provider && opts.agent) {
      console.log(c.dim(`\nModel: ${opts.provider.destination}. Code excerpts are sent there (secrets redacted).`));
      if (await p.yes("Let the agent read the code to understand the product?", true)) {
        await understandProduct(ws, { provider: opts.provider, onEvent: printEvent });
        const purpose = ws.project().classification?.purpose;
        if (purpose) console.log(`\n${c.bold("Purpose")}: ${purpose}`);
      }
    }

    if (opts.preset) ws.applyPreset(opts.preset, opts.actor);
    else if (!ws.project().presetId && ws.registry.presets.length && !opts.assumeYes) {
      console.log(`\n${c.bold("Presets")} ${c.dim("(a ready-made answer set; you can adjust it afterwards)")}`);
      ws.registry.presets.forEach((x, i) => console.log(`  ${c.dim(String(i + 1).padStart(2))} ${x.title} ${c.dim(x.id)}`));
      const pick = await p.ask("Preset number, or Enter to answer the questions yourself:");
      const preset = ws.registry.presets[Number(pick) - 1];
      if (preset) ws.applyPreset(preset.id, opts.actor);
    }
    await askQuestions(ws, p, opts.actor);
    if (opts.assumeYes) ws.confirmAnswers("all", { ...opts.actor, name: `${opts.actor.name} (--yes)` });
    printScope(ws);

    if (opts.research && opts.provider?.supportsWebSearch && (await p.yes("\nSearch the web for current guardrails beyond the registry?", false))) {
      const r = await research(ws, { provider: opts.provider, onEvent: printEvent });
      for (const rule of ws.store.readResearch().filter((x) => r.proposed.includes(x.id))) {
        console.log(`\n${c.bold(rule.id)} ${sev(rule.severity)} ${rule.title}\n${rule.requirement}\n${c.dim(rule.sources.map((s) => s.url).join(" "))}`);
        const ok = await p.yes("Accept into this project's rules?", false);
        ws.decideRule(rule.id, ok ? "accepted" : "rejected", opts.actor);
      }
    }

    const mode = opts.agent && opts.provider ? "agent" : "static";
    const audit = ws.createAudit({ mode, actor: opts.actor });
    console.log(`\n${c.bold("Audit")} ${audit.id}: ${audit.findings.length} detector finding(s).`);
    if (mode === "agent" && opts.provider) {
      console.log(c.dim("The agent now investigates every in-scope control against the code."));
      const usage = await investigate(ws, audit.id, { provider: opts.provider, onEvent: printEvent });
      console.log(c.dim(`Model usage: ${usage.inputTokens} input / ${usage.outputTokens} output tokens.`));
    } else if (!opts.provider) console.log(c.yellow("No model provider configured: detector-only audit. For a full investigation set ANTHROPIC_API_KEY, or run Assay as an MCP server inside Claude Code."));

    const s = summarize(ws.getAudit(audit.id).findings);
    console.log(`\n${c.bold("Findings")}: ${s.total} · ${["critical", "high", "medium", "low", "info"].map((k) => `${sev(k)} ${s.bySeverity[k]}`).join(" · ")}`);
    await reviewLoop(ws, audit.id, p, opts);
    if (opts.fix) await fixLoop(ws, audit.id, p, opts);

    const dir = join(ws.store.dir, "reports");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${audit.id}.md`);
    writeFileSync(file, report(ws, audit.id, "md"));
    const final = summarize(ws.getAudit(audit.id).findings);
    console.log(`\n${c.bold("Done.")} ${final.confirmed} confirmed, ${final.fixReady} fixed (awaiting acceptance), ${final.resolved} resolved, ${final.rejected} rejected, ${final.open} still open.`);
    console.log(`Report: ${file}`);
    console.log(c.dim("Review in the browser with `assay serve`, or re-run `assay audit` after changes; earlier decisions carry over."));
  } finally {
    p.close();
  }
}

/** Review the latest audit without re-scanning: open findings, fixes awaiting acceptance, then fixes. */
export async function reviewOnly(ws: Workspace, auditId: string, provider: LlmProvider | null, actor: Actor) {
  const p = new Prompter(false);
  const opts: AuditFlowOptions = { agent: true, fix: true, research: false, assumeYes: false, provider, actor };
  try {
    await reviewLoop(ws, auditId, p, opts);
    for (const f of ws.getAudit(auditId).findings.filter((x) => x.status === "fix_ready")) {
      console.log(`\n${c.bold(f.id)} ${f.title}\n${c.green(f.fix?.summary ?? "")}`);
      console.log(c.dim(`${f.fix?.verification.map((v) => `${v.passed ? "PASS" : "FAIL"} ${v.command}`).join("  ")}`));
      console.log(c.dim((f.fix?.diff ?? "").split("\n").slice(0, 60).join("\n")));
      const a = await p.choose("Accept this fix?", [["a", "ccept"], ["r", "evert"], ["l", "ater"]], "l");
      if (a === "a") await ws.review(auditId, f.id, { action: "accept-fix" }, actor);
      if (a === "r") await ws.review(auditId, f.id, { action: "revert-fix" }, actor);
    }
    await fixLoop(ws, auditId, p, opts);
  } finally {
    p.close();
  }
}
