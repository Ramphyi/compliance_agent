import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Actor, ARTIFACT_BY_ID, BATCHES, CATEGORIES, type Finding, report, SEVERITIES, summarize, type Workspace,
} from "@assay/core";
import { z } from "zod";
import { PLAYBOOK } from "./playbook";
import type { Projects } from "./projects";

export type McpContext = {
  projects: Projects;
  /** Project used when a tool call does not name one (the directory the server was started in). */
  defaultProject?: string;
  dashboardUrl?: () => string | undefined;
  clientName?: string;
  /** Throws when this client may not approve commands that run on the server. */
  canApprove?: () => void;
};

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 1) }],
});
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true });

const projectArg = { project: z.string().optional().describe("Project path or id. Defaults to the project the server was started for.") };
const confirmedArg = z
  .literal(true)
  .describe("Set to true only after the user explicitly made this decision in the conversation. Never decide on the user's behalf.");

function briefFinding(f: Finding) {
  return {
    id: f.id,
    status: f.status,
    severity: f.severity,
    title: f.title,
    category: f.category,
    where: f.locations.slice(0, 5).map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`),
    controls: f.controlIds.slice(0, 8),
    source: f.source,
    confidence: f.confidence,
  };
}

export function createMcpServer(ctx: McpContext) {
  const server = new McpServer(
    { name: "assay", version: "0.1.0" },
    {
      instructions:
        "Assay runs compliance audits: it classifies the product, asks the compliance questions, maps the code to regulations and standards, keeps a human review queue, verifies fixes with the project's build and tests, and keeps an audit trail. Read the assay://playbook resource or use the 'audit' prompt before starting. Humans make every review decision.",
    },
  );
  const host: Actor = { type: "mcp-host", name: ctx.clientName ? `${ctx.clientName} (relaying the user)` : "MCP host (relaying the user)" };
  const ws = (project?: string): Workspace => {
    const id = project ?? ctx.defaultProject;
    if (!id) throw new Error("No project given and the server has no default project. Pass `project` (a path).");
    return ctx.projects.get(id).ws;
  };
  const audit = (w: Workspace, id?: string) => w.getAudit(id);
  const wrap =
    <A,>(fn: (args: A) => unknown | Promise<unknown>) =>
    async (args: A) => {
      try {
        return text(await fn(args));
      } catch (e) {
        return fail(e);
      }
    };

  server.registerResource("playbook", "assay://playbook", { title: "Assay audit playbook", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, text: PLAYBOOK }],
  }));
  server.registerResource(
    "framework",
    new ResourceTemplate("assay://registry/{id}", {
      list: async () => ({
        resources: ws().registry.frameworks.map((f) => ({ uri: `assay://registry/${f.id}`, name: f.shortTitle, description: f.title })),
      }),
    }),
    { title: "Registry framework", mimeType: "application/json" },
    async (uri, { id }) => {
      const f = ws().registry.frameworks.find((x) => x.id === id);
      if (!f) throw new Error(`Unknown framework ${id}`);
      return { contents: [{ uri: uri.href, text: JSON.stringify(f, null, 1) }] };
    },
  );
  server.registerPrompt("audit", { title: "Run a compliance audit", description: "Audit this project with Assay, with you reviewing every finding." }, () => ({
    messages: [{ role: "user", content: { type: "text", text: `${PLAYBOOK}\n\nStart now with assay_start for this project.` } }],
  }));

  server.registerTool(
    "assay_start",
    {
      title: "Start an audit session",
      description: "Scan the project, classify it (web, embedded, automotive, medical, AI...), draft profile answers and list presets. Call first.",
      inputSchema: projectArg,
      annotations: { readOnlyHint: false },
    },
    wrap(({ project }) => {
      const w = ws(project);
      const view = w.refreshProfile(host);
      const scope = w.scopeView();
      return {
        project: { name: view.name, root: view.root },
        classification: view.classification && {
          summary: view.classification.summary,
          purpose: view.classification.purpose,
          productTypes: view.classification.productTypes,
          languages: view.classification.languages.slice(0, 6),
          signals: view.classification.signals.map((s) => ({ id: s.id, label: s.label, examples: s.refs.slice(0, 2).map((r) => `${r.path}${r.line ? `:${r.line}` : ""}`) })),
        },
        answers: Object.fromEntries(view.questions.filter((q) => q.answer).map((q) => [q.id, { value: q.answer!.value, confirmed: q.answer!.confirmed, why: q.answer!.rationale }])),
        unanswered: view.questions.filter((q) => !q.answer).map((q) => q.id),
        presets: view.presets,
        frameworks: {
          applies: scope.filter((s) => s.active).map((s) => s.shortTitle),
          undecided: scope.filter((s) => s.status === "unknown" && !s.override).map((s) => ({ framework: s.shortTitle, needs: s.missingFacts })),
        },
        verify: view.verify,
        registryErrors: w.registryErrors.length || undefined,
        dashboard: ctx.dashboardUrl?.(),
        next: "Describe the product to the user, then ask the questions for unanswered and unconfirmed facts (assay_questions shows options), or offer a preset.",
      };
    }),
  );

  server.registerTool(
    "assay_questions",
    { title: "Compliance questions", description: "The questionnaire with options, current answers and why each question matters.", inputSchema: projectArg, annotations: { readOnlyHint: true } },
    wrap(({ project }) =>
      ws(project).profileView().questions.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.text,
        why: q.why,
        options: q.options?.map((o) => `${o.value} = ${o.label}`),
        answer: q.answer ? { value: q.answer.value, confirmed: q.answer.confirmed, source: q.answer.source } : null,
      })),
    ),
  );

  server.registerTool(
    "assay_answer",
    {
      title: "Save answers",
      description: "Save questionnaire answers (exact option values) and optionally the product purpose. Use user_confirmed only for answers the user gave or explicitly confirmed.",
      inputSchema: {
        ...projectArg,
        answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
        purpose: z.string().optional(),
        confirm_ids: z.array(z.string()).optional().describe("Existing answers the user explicitly confirmed."),
        user_confirmed: z.boolean().describe("True when these answers come from the user; false for your own suggestions."),
      },
    },
    wrap(({ project, answers, purpose, confirm_ids, user_confirmed }) => {
      const w = ws(project);
      if (purpose) w.setPurpose(purpose, host);
      if (answers && Object.keys(answers).length) w.setAnswers(answers, host, { confirm: user_confirmed });
      if (confirm_ids?.length) {
        if (!user_confirmed) throw new Error("confirm_ids requires user_confirmed=true");
        w.confirmAnswers(confirm_ids, host);
      }
      const v = w.profileView();
      return { completeness: v.completeness, frameworks: w.scopeView().filter((s) => s.active).map((s) => s.shortTitle) };
    }),
  );

  server.registerTool(
    "assay_apply_preset",
    { title: "Apply a preset", description: "Apply a ready-made answer set for a product type. The user should confirm it.", inputSchema: { ...projectArg, preset: z.string() } },
    wrap(({ project, preset }) => {
      const v = ws(project).applyPreset(preset, host);
      return { applied: preset, completeness: v.completeness };
    }),
  );

  server.registerTool(
    "assay_scope",
    {
      title: "Frameworks in scope",
      description: "Which regulations and standards apply and why. Optionally include or exclude frameworks when the user asks.",
      inputSchema: {
        ...projectArg,
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        reset: z.array(z.string()).optional(),
      },
    },
    wrap(({ project, include, exclude, reset }) => {
      const w = ws(project);
      for (const id of include ?? []) w.setScopeOverride(id, "include", host);
      for (const id of exclude ?? []) w.setScopeOverride(id, "exclude", host);
      for (const id of reset ?? []) w.setScopeOverride(id, null, host);
      return w.scopeView().map((s) => ({
        id: s.frameworkId,
        name: s.shortTitle,
        version: s.version,
        status: s.override ? `${s.override}d manually` : s.status,
        active: s.active,
        controls: s.controls,
        why: s.status === "unknown" ? `needs: ${s.missingFacts.join(", ")}` : s.reason.split("\n")[0].slice(0, 240),
      }));
    }),
  );

  server.registerTool(
    "assay_run_audit",
    {
      title: "Run the audit",
      description: "Run detectors against the in-scope controls, carry over earlier decisions, and return investigation batches for you to work through with assay_controls.",
      inputSchema: projectArg,
    },
    wrap(({ project }) => {
      const w = ws(project);
      const a = w.createAudit({ mode: "mcp", actor: host });
      const controls = w.controlsInScope();
      return {
        audit_id: a.id,
        summary: summarize(a.findings),
        detector_findings: a.findings.slice(0, 60).map(briefFinding),
        batches: BATCHES.map((b) => ({ id: b.id, title: b.title, controls: controls.filter((c) => b.categories.includes(c.category)).length })).filter((b) => b.controls),
        next: "For each batch: assay_controls, investigate, assay_record_findings / assay_annotate / assay_assess_control. Then present findings to the user.",
      };
    }),
  );

  server.registerTool(
    "assay_controls",
    {
      title: "Controls to investigate",
      description: "Controls of one investigation batch (or framework), with requirement, what to check, detectors and related findings.",
      inputSchema: { ...projectArg, batch: z.string().optional(), framework: z.string().optional(), audit_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(({ project, batch, framework, audit_id }) => {
      const w = ws(project);
      const b = batch ? BATCHES.find((x) => x.id === batch) : undefined;
      if (batch && !b) throw new Error(`Unknown batch. Batches: ${BATCHES.map((x) => x.id).join(", ")}`);
      const a = audit(w, audit_id);
      const list = w.controlsInScope().filter((c) => (!b || b.categories.includes(c.category)) && (!framework || c.frameworkId === framework));
      return list.map((c) => ({
        id: c.id,
        framework: c.frameworkTitle,
        title: c.title,
        severity: c.severity,
        requirement: c.requirement.trim(),
        check: c.guidance.trim(),
        evidence: c.evidence,
        artifacts: c.artifacts.map((x) => ARTIFACT_BY_ID.get(x)?.title ?? x),
        status: a.controls.find((x) => x.controlId === c.id)?.status,
        findings: a.findings.filter((f) => f.controlIds.includes(c.id)).map((f) => `${f.id} ${f.status} ${f.title}`),
      }));
    }),
  );

  const findingSchema = z.object({
    title: z.string(),
    description: z.string(),
    severity: z.enum(SEVERITIES),
    category: z.enum(CATEGORIES),
    kind: z.enum(["code", "configuration", "dependency", "missing-artifact", "process"]).optional(),
    fixability: z.enum(["code", "document", "process"]).optional(),
    control_ids: z.array(z.string()),
    locations: z.array(z.object({ path: z.string(), line: z.number().int().optional(), end_line: z.number().int().optional() })),
    evidence: z.string(),
    recommendation: z.string(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
  });

  server.registerTool(
    "assay_record_findings",
    { title: "Record findings", description: "Record findings from your investigation for human review.", inputSchema: { ...projectArg, audit_id: z.string().optional(), findings: z.array(findingSchema).min(1) } },
    wrap(({ project, audit_id, findings }) => {
      const w = ws(project);
      const added = w.addFindings(
        audit(w, audit_id).id,
        findings.map((f) => ({
          ...f,
          controlIds: f.control_ids,
          locations: f.locations.map((l) => ({ path: l.path, line: l.line, endLine: l.end_line })),
        })),
        host,
      );
      return added.map(briefFinding);
    }),
  );

  server.registerTool(
    "assay_annotate",
    { title: "Annotate a finding", description: "Add your assessment to a finding (for example: likely false positive because...). Does not change its status.", inputSchema: { ...projectArg, audit_id: z.string().optional(), finding_id: z.string(), note: z.string() } },
    wrap(({ project, audit_id, finding_id, note }) => {
      const w = ws(project);
      w.annotateFinding(audit(w, audit_id).id, finding_id, note, host);
      return "Noted.";
    }),
  );

  server.registerTool(
    "assay_assess_control",
    {
      title: "Assess a control",
      description: "Mark a control verified (you saw a compliant implementation; give evidence) or needs-evidence.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), control_id: z.string(), status: z.enum(["verified", "needs-evidence"]), note: z.string() },
    },
    wrap(({ project, audit_id, control_id, status, note }) => {
      const w = ws(project);
      w.assessControl(audit(w, audit_id).id, control_id, status, note, host);
      return "Saved.";
    }),
  );

  server.registerTool(
    "assay_findings",
    {
      title: "List findings",
      description: "Findings of the latest (or given) audit with status and allowed review actions. Filter by status or severity. Pass finding_id for full detail.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), status: z.array(z.string()).optional(), severity: z.array(z.enum(SEVERITIES)).optional(), finding_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(({ project, audit_id, status, severity, finding_id }) => {
      const w = ws(project);
      const a = audit(w, audit_id);
      if (finding_id) {
        const f = a.findings.find((x) => x.id === finding_id);
        if (!f) throw new Error(`Finding ${finding_id} not found`);
        const { fix, ...rest } = w.findingView(f);
        return { ...rest, fix: fix && { ...fix, diff: fix.diff.slice(0, 12_000) } };
      }
      return {
        audit_id: a.id,
        phase: a.phase,
        summary: summarize(a.findings),
        findings: a.findings.filter((f) => (!status || status.includes(f.status)) && (!severity || severity.includes(f.severity))).map((f) => ({ ...briefFinding(f), actions: w.findingView(f).actions })),
        dashboard: ctx.dashboardUrl?.(),
      };
    }),
  );

  server.registerTool(
    "assay_review",
    {
      title: "Record the user's review decision",
      description: "Relay a decision the USER made: confirm, reject (needs reason), modify (changes, optionally confirm), reinvestigate (needs note), reopen, resolve, accept-fix, revert-fix.",
      inputSchema: {
        ...projectArg,
        audit_id: z.string().optional(),
        finding_id: z.string(),
        action: z.enum(["confirm", "reject", "modify", "reinvestigate", "reopen", "resolve", "accept-fix", "revert-fix"]),
        note: z.string().optional(),
        reason: z.enum(["false-positive", "accepted-risk", "not-applicable", "duplicate", "other"]).optional(),
        changes: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            severity: z.enum(SEVERITIES).optional(),
            recommendation: z.string().optional(),
            fixInstructions: z.string().optional(),
            fixability: z.enum(["code", "document", "process"]).optional(),
          })
          .optional(),
        confirm: z.boolean().optional(),
        user_confirmed: confirmedArg,
      },
    },
    wrap(async ({ project, audit_id, finding_id, action, note, reason, changes, confirm }) => {
      const w = ws(project);
      const f = await w.review(audit(w, audit_id).id, finding_id, { action, note, reason, changes, confirm }, host);
      return { ...briefFinding(f), next: action === "reinvestigate" ? "Re-investigate now with the user's note, then call assay_complete_reinvestigation." : undefined };
    }),
  );

  server.registerTool(
    "assay_wait_for_review",
    {
      title: "Wait for dashboard decisions",
      description: "Wait until the user changes a finding in the dashboard (or timeout), then return the work queue: re-investigations, confirmed findings to fix, fixes awaiting acceptance.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), timeout_seconds: z.number().int().min(5).max(600).optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ project, audit_id, timeout_seconds }) => {
      const w = ws(project);
      const id = audit(w, audit_id).id;
      const sig = () => audit(w, id).findings.map((f) => `${f.id}:${f.status}:${f.history.length}`).join(",");
      const start = sig();
      const deadline = Date.now() + (timeout_seconds ?? 120) * 1000;
      while (Date.now() < deadline && sig() === start) await new Promise((r) => setTimeout(r, 1500));
      const a = audit(w, id);
      const pick = (s: string) => a.findings.filter((f) => f.status === s);
      return {
        changed: sig() !== start,
        awaiting_review: pick("open").length,
        reinvestigate: pick("reinvestigating").map((f) => ({ ...briefFinding(f), reviewer_note: f.reinvestigateNote })),
        ready_to_fix: pick("confirmed").map((f) => ({ ...briefFinding(f), instructions: f.fixInstructions })),
        fixes_awaiting_acceptance: pick("fix_ready").map(briefFinding),
      };
    }),
  );

  server.registerTool(
    "assay_complete_reinvestigation",
    {
      title: "Complete a re-investigation",
      description: "Report the outcome of re-investigating a finding the user sent back.",
      inputSchema: {
        ...projectArg,
        audit_id: z.string().optional(),
        finding_id: z.string(),
        verdict: z.enum(["still-valid", "revised", "withdraw"]),
        note: z.string(),
        updates: z
          .object({
            title: z.string().optional(),
            description: z.string().optional(),
            severity: z.enum(SEVERITIES).optional(),
            recommendation: z.string().optional(),
            evidence: z.string().optional(),
          })
          .optional(),
      },
    },
    wrap(({ project, audit_id, finding_id, verdict, note, updates }) => {
      const w = ws(project);
      return briefFinding(w.completeReinvestigation(audit(w, audit_id).id, finding_id, { verdict, note, updates }, host));
    }),
  );

  server.registerTool(
    "assay_verify_config",
    {
      title: "Verification commands",
      description: "Show or set the build and test commands used to verify fixes. Approving runs project code, so approve only with the user's explicit consent.",
      inputSchema: { ...projectArg, commands: z.array(z.string()).optional(), approve: z.boolean().optional(), user_confirmed: z.boolean().optional() },
    },
    wrap(({ project, commands, approve, user_confirmed }) => {
      const w = ws(project);
      if (approve && !user_confirmed) throw new Error("Approving commands requires user_confirmed=true after the user agreed");
      if (approve) ctx.canApprove?.();
      if (commands || approve) return w.setVerify(commands ?? w.verifyConfig().commands, { approve: Boolean(approve) }, host);
      return w.verifyConfig();
    }),
  );

  server.registerTool(
    "assay_begin_fix",
    {
      title: "Begin fixing a confirmed finding",
      description: "Checks the working tree is clean, switches to the fix branch and returns everything needed to fix the finding with your own editing tools.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), finding_id: z.string() },
    },
    wrap(({ project, audit_id, finding_id }) => {
      const w = ws(project);
      const v = w.verifyConfig();
      if (v.commands.length && !v.approved) throw new Error("Verification commands are not approved yet. Ask the user, then call assay_verify_config with approve=true.");
      const { finding, base } = w.beginFix(audit(w, audit_id).id, finding_id, host);
      const art = finding.artifactId ? ARTIFACT_BY_ID.get(finding.artifactId) : undefined;
      return {
        finding: w.findingView(finding),
        base_commit: base,
        branch: finding.fix?.branch,
        draft_document: art && { path: art.draftPath, must_cover: art.draftHint },
        verify_commands: v.commands,
        rules:
          "Smallest correct change, existing style, add a test when behaviour changes, never weaken security or delete tests, for documents write a DRAFT with [OWNER TO CONFIRM] placeholders. Then call assay_complete_fix.",
      };
    }),
  );

  server.registerTool(
    "assay_complete_fix",
    {
      title: "Verify and commit a fix",
      description: "Runs the approved build and test commands and the detector, then commits the change (fix_ready) or returns the failure so you can try again.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), finding_id: z.string(), summary: z.string(), final: z.boolean().optional().describe("Roll back instead of allowing another attempt if it fails.") },
    },
    wrap(async ({ project, audit_id, finding_id, summary, final }) => {
      const w = ws(project);
      const r = await w.completeFix(audit(w, audit_id).id, finding_id, { summary, actor: host, final });
      return {
        ok: r.ok,
        status: r.finding.status,
        error: r.error,
        can_retry: r.retry,
        commit: r.finding.fix?.commit,
        verification: r.verification.map((v) => ({ command: v.command, passed: v.passed, exit: v.exitCode, output: v.passed ? undefined : v.output.slice(-4000) })),
        next: r.ok ? "Ask the user to accept or revert the fix." : r.retry ? "Fix the failure and call assay_complete_fix again." : "The change was rolled back; tell the user.",
      };
    }),
  );

  server.registerTool(
    "assay_abort_fix",
    { title: "Abandon a fix", description: "Roll back the working-tree changes for a finding and mark the fix failed.", inputSchema: { ...projectArg, audit_id: z.string().optional(), finding_id: z.string(), reason: z.string() } },
    wrap(({ project, audit_id, finding_id, reason }) => {
      const w = ws(project);
      w.abortFix(audit(w, audit_id).id, finding_id, reason, host);
      return "Rolled back.";
    }),
  );

  server.registerTool(
    "assay_propose_rules",
    {
      title: "Propose researched rules",
      description: "Submit requirements you found by web research (official sources) for the user to accept into this project's rule set.",
      inputSchema: {
        ...projectArg,
        rules: z
          .array(
            z.object({
              title: z.string(),
              requirement: z.string(),
              guidance: z.string(),
              severity: z.enum(SEVERITIES),
              category: z.enum(CATEGORIES),
              sources: z.array(z.object({ title: z.string(), url: z.string() })).min(1),
            }),
          )
          .min(1),
      },
    },
    wrap(({ project, rules }) => ws(project).proposeRules(rules, host).map((r) => ({ id: r.id, title: r.title, status: r.status }))),
  );

  server.registerTool(
    "assay_decide_rule",
    {
      title: "Accept or reject a researched rule",
      description: "Relay the user's decision on a proposed rule.",
      inputSchema: { ...projectArg, rule_id: z.string(), decision: z.enum(["accepted", "rejected"]), user_confirmed: confirmedArg },
    },
    wrap(({ project, rule_id, decision }) => {
      ws(project).decideRule(rule_id, decision, host);
      return "Saved.";
    }),
  );

  server.registerTool(
    "assay_report",
    {
      title: "Audit report",
      description: "Markdown, JSON or SARIF report of the latest (or given) audit. Also saved under .assay/reports.",
      inputSchema: { ...projectArg, audit_id: z.string().optional(), format: z.enum(["md", "json", "sarif"]).optional() },
      annotations: { readOnlyHint: true },
    },
    wrap(({ project, audit_id, format }) => {
      const w = ws(project);
      const fmt = format ?? "md";
      const a = audit(w, audit_id);
      const out = report(w, a.id, fmt);
      const dir = join(w.store.dir, "reports");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${a.id}.${fmt === "md" ? "md" : fmt === "sarif" ? "sarif" : "json"}`);
      writeFileSync(file, out);
      return fmt === "md" ? `${out}\n\n(saved to ${file})` : `Saved to ${file} (${out.length} bytes).`;
    }),
  );

  server.registerTool(
    "assay_dashboard",
    { title: "Dashboard link", description: "URL of the Assay dashboard where the user can review findings and diffs.", inputSchema: {}, annotations: { readOnlyHint: true } },
    wrap(() => ctx.dashboardUrl?.() ?? "No dashboard is running. Start one with `assay serve` or run the MCP server with --dashboard."),
  );

  return server;
}
