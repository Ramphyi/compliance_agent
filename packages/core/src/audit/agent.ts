import { z } from "zod";
import { ARTIFACT_BY_ID } from "../checks/artifacts";
import { CATEGORIES, CATEGORY_LABELS, type Category, SEVERITIES } from "../registry/ids";
import type { Control } from "../registry/schema";
import { ReviewError } from "../review";
import { type AgentEvent, type AgentTool, type LlmProvider, tool } from "../llm/provider";
import { readTools, type ToolContext, writeTools } from "../llm/tools";
import type { Actor, Finding } from "../types";
import type { Workspace } from "../workspace";
import { AUDITOR_SYSTEM, FIXER_SYSTEM, REINVESTIGATE_SYSTEM, RESEARCH_SYSTEM, UNDERSTAND_SYSTEM } from "./prompts";

export type AgentOptions = {
  provider: LlmProvider;
  onEvent?: (e: AgentEvent & { stage?: string }) => void;
  signal?: AbortSignal;
  maxTurns?: number;
};

export const agentActor = (p: LlmProvider): Actor => ({ type: "agent", name: `assay-agent/${p.model}` });

/** Investigation batches: related categories are reviewed together to share context. */
export const BATCHES: { id: string; title: string; categories: Category[] }[] = [
  { id: "access-crypto", title: "Authentication, secrets and cryptography", categories: ["authentication-access", "secrets-management", "cryptography"] },
  { id: "code-safety", title: "Input handling and code safety", categories: ["input-validation", "code-safety"] },
  { id: "privacy", title: "Personal data, privacy and consumer rules", categories: ["data-protection", "privacy-rights", "consumer-protection", "platform-policy", "accessibility"] },
  { id: "comms-device", title: "Communications, device and update security", categories: ["communications-security", "hardware-security", "updates-maintenance"] },
  { id: "safety-quality", title: "Functional safety, resilience and verification", categories: ["functional-safety", "resilience-availability", "testing-verification"] },
  { id: "ai", title: "AI governance, AI security and transparency", categories: ["ai-governance", "ai-security", "transparency-documentation"] },
  { id: "lifecycle", title: "Secure development, supply chain, vulnerabilities and logging", categories: ["secure-development", "supply-chain", "vulnerability-management", "logging-monitoring"] },
  { id: "governance", title: "Governance and risk assessment", categories: ["governance", "risk-assessment"] },
];

function toolContext(ws: Workspace): ToolContext {
  const { snapshot } = ws.scan();
  return { root: ws.root, stateDir: ws.store.dir, paths: [...snapshot.paths], changed: new Set() };
}

function productContext(ws: Workspace) {
  const p = ws.project();
  const c = p.classification;
  const answers = Object.entries(p.answers)
    .map(([k, a]) => `- ${k}: ${Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}${a.confirmed ? "" : " (unconfirmed)"}`)
    .join("\n");
  return [
    `Project: ${p.name}`,
    c?.purpose ? `Purpose: ${c.purpose}` : "",
    c ? `Classification: ${c.summary}` : "",
    c?.languages.length ? `Languages: ${c.languages.map((l) => `${l.name} (${l.files})`).join(", ")}` : "",
    `Profile answers:\n${answers || "- none yet"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function fileTree(ws: Workspace, max = 400) {
  const { snapshot } = ws.scan();
  const paths = snapshot.paths.slice(0, max);
  return paths.join("\n") + (snapshot.paths.length > max ? `\n... and ${snapshot.paths.length - max} more (use list_files)` : "");
}

function controlBrief(c: Control) {
  const extra = [
    c.checks.length ? `detectors: ${c.checks.join(", ")}` : "",
    c.artifacts.length ? `evidence artifacts: ${c.artifacts.map((a) => ARTIFACT_BY_ID.get(a)?.title ?? a).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  return `### ${c.id} [${c.severity}] ${c.title}\nRequirement: ${c.requirement.trim()}\nWhat to check: ${c.guidance.trim()}${extra ? `\n(${extra})` : ""}`;
}

function findingBrief(f: Finding) {
  const loc = f.locations.slice(0, 4).map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`).join(", ");
  return `- ${f.id} [${f.severity}/${f.status}] ${f.title}${loc ? ` @ ${loc}` : ""}`;
}

const findingInput = z.object({
  title: z.string().min(5).max(160),
  description: z.string().min(10).describe("What is wrong and why it matters for the cited requirements."),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  kind: z.enum(["code", "configuration", "dependency", "missing-artifact", "process"]),
  fixability: z.enum(["code", "document", "process"]).describe("code: fixable by changing code; document: needs a document drafted; process: needs an organisational decision."),
  control_ids: z.array(z.string()).describe("Control ids from the list provided that this finding violates."),
  locations: z.array(z.object({ path: z.string(), line: z.number().int().optional(), end_line: z.number().int().optional() })).describe("Where the issue is. Empty only for absent artifacts."),
  evidence: z.string().min(10).describe("What you read or searched that supports the finding."),
  recommendation: z.string().min(10),
  confidence: z.enum(["high", "medium", "low"]),
});

function auditTools(ws: Workspace, auditId: string, allowedControls: Set<string>, actor: Actor, recorded: string[]): AgentTool<any>[] {
  return [
    tool({
      name: "record_finding",
      description: "Record a compliance or security finding for human review. Use only control ids from the provided list.",
      schema: findingInput,
      run: (f) => {
        const bad = f.control_ids.filter((c) => !allowedControls.has(c));
        if (bad.length) throw new Error(`Unknown or out-of-batch control ids: ${bad.join(", ")}`);
        const [added] = ws.addFindings(
          auditId,
          [
            {
              title: f.title,
              description: f.description,
              severity: f.severity,
              category: f.category,
              kind: f.kind,
              fixability: f.fixability,
              controlIds: f.control_ids,
              locations: f.locations.map((l) => ({ path: l.path, line: l.line, endLine: l.end_line })),
              evidence: f.evidence,
              recommendation: f.recommendation,
              confidence: f.confidence,
            },
          ],
          actor,
        );
        recorded.push(added.id);
        return `Recorded ${added.id}.`;
      },
    }),
    tool({
      name: "annotate_finding",
      description: "Add your assessment to an existing finding (for example that a detector hit is a likely false positive, or confirmed by reading the code). Does not change its status; the human decides.",
      schema: z.object({ finding_id: z.string(), note: z.string().min(5) }),
      run: ({ finding_id, note }) => {
        ws.annotateFinding(auditId, finding_id, note, actor);
        return "Noted.";
      },
    }),
    tool({
      name: "assess_control",
      description: "Record that a control is implemented (verified, with evidence) or that evidence is still needed.",
      schema: z.object({ control_id: z.string(), status: z.enum(["verified", "needs-evidence"]), note: z.string().min(5) }),
      run: ({ control_id, status, note }) => {
        if (!allowedControls.has(control_id)) throw new Error(`Control ${control_id} is not in this batch`);
        ws.assessControl(auditId, control_id, status, note, actor);
        return "Saved.";
      },
    }),
    tool({
      name: "finish",
      description: "End this part of the investigation with a short summary for the report.",
      schema: z.object({ summary: z.string().min(5) }),
      run: ({ summary }) => {
        ws.addNote(auditId, "investigation", summary, actor);
        return "Done.";
      },
    }),
  ];
}

function emit(opts: AgentOptions, stage: string) {
  return (e: AgentEvent) => opts.onEvent?.({ ...e, stage });
}

/** Let the agent read the repository and describe the product; answers stay unconfirmed. */
export async function understandProduct(ws: Workspace, opts: AgentOptions) {
  const actor = agentActor(opts.provider);
  ws.refreshProfile(actor);
  const questions = ws.registry.questionnaire.questions
    .map((q) => `- ${q.id} (${q.type}): ${q.text}${q.options ? ` Options: ${q.options.map((o) => o.value).join(", ")}` : ""}`)
    .join("\n");
  const pending: Record<string, string | string[]> = {};
  const tools = [
    ...readTools(toolContext(ws)),
    tool({
      name: "set_purpose",
      description: "Describe what the product is for, who uses it, where it runs and what data it handles.",
      schema: z.object({ purpose: z.string().min(20).max(1200) }),
      run: ({ purpose }) => {
        ws.setPurpose(purpose, actor);
        return "Saved.";
      },
    }),
    tool({
      name: "suggest_answer",
      description: "Suggest an answer for a questionnaire fact. Use exact option values. A person confirms it later.",
      schema: z.object({ fact: z.string(), value: z.union([z.string(), z.array(z.string())]), rationale: z.string().min(5) }),
      run: ({ fact, value, rationale }) => {
        ws.setAnswers({ [fact]: value }, actor, { confirm: false, rationale });
        pending[fact] = value;
        return "Saved as unconfirmed.";
      },
    }),
    tool({ name: "finish", description: "Finish.", schema: z.object({ summary: z.string() }), run: () => "Done." }),
  ];
  const r = await opts.provider.run({
    system: UNDERSTAND_SYSTEM,
    prompt: `${productContext(ws)}\n\nQuestionnaire:\n${questions}\n\nRepository files:\n${fileTree(ws)}`,
    tools,
    maxTurns: opts.maxTurns ?? 25,
    finishTool: "finish",
    onEvent: emit(opts, "understand"),
    signal: opts.signal,
  });
  return { suggested: pending, usage: r.usage };
}

/**
 * Agent investigation of the in-scope controls. Batches are independent (read-only tools; findings
 * are written through the locked store), so they run in parallel (ASSAY_PARALLEL, default 3), and a
 * failure in one batch is recorded without losing the others.
 */
export async function investigate(ws: Workspace, auditId: string, opts: AgentOptions & { batches?: string[]; parallel?: number }) {
  const actor = agentActor(opts.provider);
  const controls = ws.controlsInScope();
  const usage = { inputTokens: 0, outputTokens: 0 };
  ws.setPhase(auditId, "investigating", { model: opts.provider.model });
  const work = BATCHES.filter((b) => (!opts.batches || opts.batches.includes(b.id)) && controls.some((c) => b.categories.includes(c.category)));
  const failures: string[] = [];

  const runBatch = async (batch: (typeof BATCHES)[number]) => {
    if (opts.signal?.aborted) return;
    const batchControls = controls.filter((c) => batch.categories.includes(c.category));
    const audit = ws.getAudit(auditId);
    const existing = audit.findings.filter((f) => batch.categories.includes(f.category));
    const recorded: string[] = [];
    opts.onEvent?.({ type: "notice", message: `Investigating: ${batch.title} (${batchControls.length} controls)`, stage: batch.id });
    try {
      const r = await opts.provider.run({
        system: AUDITOR_SYSTEM,
        prompt: [
          productContext(ws),
          `\n## Scope of this pass: ${batch.title}\nCategories: ${batch.categories.map((c) => CATEGORY_LABELS[c]).join(", ")}`,
          `\n## Controls to assess\n${batchControls.map(controlBrief).join("\n\n")}`,
          `\n## Findings already reported by detectors (validate, do not duplicate)\n${existing.map(findingBrief).join("\n") || "- none"}`,
          `\n## Repository files\n${fileTree(ws)}`,
          `\nInvestigate each control against the code. Record new findings, annotate detector findings you can confirm or refute, mark controls you verified, then call finish.`,
        ].join("\n"),
        tools: [...readTools(toolContext(ws)), ...auditTools(ws, auditId, new Set(batchControls.map((c) => c.id)), actor, recorded)],
        maxTurns: opts.maxTurns ?? Number(process.env.ASSAY_MAX_TURNS ?? 40),
        finishTool: "finish",
        onEvent: emit(opts, batch.id),
        signal: opts.signal,
      });
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      if (r.stopReason !== "done") ws.addNote(auditId, batch.id, `Investigation of "${batch.title}" ended early (${r.stopReason}).`, actor);
      opts.onEvent?.({ type: "notice", message: `Done: ${batch.title} (${recorded.length} new findings)`, stage: batch.id });
    } catch (e) {
      if (opts.signal?.aborted) return;
      const msg = (e as Error).message;
      failures.push(`${batch.title}: ${msg}`);
      ws.addNote(auditId, batch.id, `Investigation of "${batch.title}" failed: ${msg}. Findings recorded before the failure are kept; run the agent audit again to retry.`, actor);
      opts.onEvent?.({ type: "notice", message: `Failed: ${batch.title} (${msg})`, stage: batch.id });
    }
  };

  const limit = Math.max(1, opts.parallel ?? Number(process.env.ASSAY_PARALLEL ?? 3));
  const queue = [...work];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) await runBatch(b);
  }));

  const prev = ws.getAudit(auditId).usage;
  ws.setPhase(auditId, "review", {
    usage: { inputTokens: (prev?.inputTokens ?? 0) + usage.inputTokens, outputTokens: (prev?.outputTokens ?? 0) + usage.outputTokens },
    error: failures.length ? `${failures.length} of ${work.length} investigation batches failed: ${failures.join("; ")}` : undefined,
  });
  if (work.length && failures.length === work.length) throw new Error(`Every investigation batch failed. First error: ${failures[0]}`);
  return usage;
}

export async function reinvestigate(ws: Workspace, auditId: string, findingId: string, opts: AgentOptions) {
  const actor = agentActor(opts.provider);
  const f = ws.getAudit(auditId).findings.find((x) => x.id === findingId);
  if (!f) throw new Error(`Finding ${findingId} not found`);
  if (f.status !== "reinvestigating") throw new ReviewError(`${findingId} is not awaiting re-investigation`);
  const controls = f.controlIds.map((id) => ws.registry.controls.get(id)).filter((c): c is Control => Boolean(c));
  let concluded = false;
  const tools = [
    ...readTools(toolContext(ws)),
    tool({
      name: "conclude",
      description: "Conclude the re-investigation.",
      schema: z.object({
        verdict: z.enum(["still-valid", "revised", "withdraw"]),
        note: z.string().min(10),
        title: z.string().optional(),
        description: z.string().optional(),
        severity: z.enum(SEVERITIES).optional(),
        recommendation: z.string().optional(),
        evidence: z.string().optional(),
        locations: z.array(z.object({ path: z.string(), line: z.number().int().optional() })).optional(),
      }),
      run: ({ verdict, note, ...updates }) => {
        ws.completeReinvestigation(auditId, findingId, { verdict, note, updates }, actor);
        concluded = true;
        return "Saved.";
      },
    }),
  ];
  const r = await opts.provider.run({
    system: REINVESTIGATE_SYSTEM,
    prompt: [
      productContext(ws),
      `\n## Finding ${f.id}: ${f.title}\nSeverity: ${f.severity}\nDescription: ${f.description}\nEvidence: ${f.evidence}\nLocations: ${f.locations.map((l) => `${l.path}${l.line ? `:${l.line}` : ""}`).join(", ") || "none"}\nRecommendation: ${f.recommendation}`,
      `\n## Reviewer's note (why they asked you to look again)\n${f.reinvestigateNote}`,
      controls.length ? `\n## Controls\n${controls.map(controlBrief).join("\n\n")}` : "",
      `\n## History\n${f.history.map((h) => `- ${h.at} ${h.by.name}: ${h.action}${h.note ? ` — ${h.note}` : ""}`).join("\n")}`,
    ].join("\n"),
    tools,
    maxTurns: opts.maxTurns ?? 25,
    finishTool: "conclude",
    onEvent: emit(opts, `reinvestigate:${findingId}`),
    signal: opts.signal,
  });
  if (!concluded) {
    ws.completeReinvestigation(auditId, findingId, { verdict: "still-valid", note: `The agent did not reach a conclusion (${r.stopReason}); the finding is unchanged.` }, actor);
  }
  return ws.getAudit(auditId).findings.find((x) => x.id === findingId)!;
}

/** Fix one confirmed finding: edit, verify, retry on failure, then commit for human acceptance. */
export async function fixFinding(ws: Workspace, auditId: string, findingId: string, opts: AgentOptions) {
  const actor = agentActor(opts.provider);
  const v = ws.verifyConfig();
  if (v.commands.length && !v.approved)
    throw new ReviewError("Approve the build and test commands first; they run project code and are needed to verify fixes.");
  const { finding } = ws.beginFix(auditId, findingId, actor);
  try {
    return await runFixAttempts(ws, auditId, findingId, finding, actor, opts);
  } catch (e) {
    // A model or network failure must not leave half-edited files or a finding stuck in "fixing".
    const current = ws.getAudit(auditId).findings.find((x) => x.id === findingId);
    if (current?.status === "fixing") ws.abortFix(auditId, findingId, `The fix was interrupted: ${(e as Error).message}`, actor);
    throw e;
  }
}

async function runFixAttempts(ws: Workspace, auditId: string, findingId: string, finding: Finding, actor: Actor, opts: AgentOptions) {
  const controls = finding.controlIds.map((id) => ws.registry.controls.get(id)).filter((c): c is Control => Boolean(c));
  const artifact = finding.artifactId ? ARTIFACT_BY_ID.get(finding.artifactId) : undefined;
  let lastFailure = "";
  for (let attempt = 1; attempt <= ws.project().fix.maxAttempts; attempt++) {
    const ctx = toolContext(ws);
    let summary = "";
    const tools = [
      ...readTools(ctx),
      ...writeTools(ctx),
      tool({
        name: "run_verification",
        description: "Run the project's approved build and test commands and return the result.",
        schema: z.object({}),
        run: async () => {
          const runs = await ws.runVerify(opts.signal);
          if (!runs.length) return "No verification commands are configured for this project.";
          return runs.map((r) => `$ ${r.command}\nexit ${r.exitCode}${r.timedOut ? " (timed out)" : ""} in ${r.durationMs} ms\n${r.output.slice(-4000)}`).join("\n\n");
        },
      }),
      tool({
        name: "finish_fix",
        description: "Finish the fix with a summary for the reviewer.",
        schema: z.object({ summary: z.string().min(10) }),
        run: ({ summary: s }) => {
          summary = s;
          return "Submitted for verification.";
        },
      }),
    ];
    const r = await opts.provider.run({
      system: FIXER_SYSTEM,
      prompt: [
        productContext(ws),
        `\n## Finding ${finding.id}: ${finding.title}\nSeverity: ${finding.severity}\nDescription: ${finding.description}\nEvidence: ${finding.evidence}\nLocations:\n${finding.locations.map((l) => `- ${l.path}${l.line ? `:${l.line}` : ""}${l.excerpt ? `  ${l.excerpt}` : ""}`).join("\n") || "- none"}\nRecommendation: ${finding.recommendation}`,
        finding.fixInstructions ? `\n## Reviewer's instructions (follow these)\n${finding.fixInstructions}` : "",
        artifact ? `\n## Document to draft\nPath: ${artifact.draftPath}\nMust cover: ${artifact.draftHint}` : "",
        controls.length ? `\n## Requirements this fix must satisfy\n${controls.map(controlBrief).join("\n\n")}` : "",
        `\n## Verification commands\n${ws.verifyConfig().commands.join("\n") || "none configured"}`,
        lastFailure ? `\n## Previous attempt failed verification\n${lastFailure}\nThe working tree still contains that attempt; fix the cause.` : "",
        `\nAttempt ${attempt} of ${ws.project().fix.maxAttempts}.`,
      ].join("\n"),
      tools,
      maxTurns: opts.maxTurns ?? 40,
      finishTool: "finish_fix",
      onEvent: emit(opts, `fix:${findingId}`),
      signal: opts.signal,
    });
    if (opts.signal?.aborted) {
      ws.abortFix(auditId, findingId, "Cancelled by the user.", actor);
      break;
    }
    const final = attempt === ws.project().fix.maxAttempts;
    const res = await ws.completeFix(auditId, findingId, {
      summary: summary || r.text.slice(-1500) || "No summary provided.",
      actor,
      final,
      signal: opts.signal,
    });
    if (res.ok || !res.retry) return res.finding;
    lastFailure = `${res.error}\n${res.verification.filter((x) => !x.passed).map((x) => `$ ${x.command}\n${x.output.slice(-3000)}`).join("\n")}`;
  }
  return ws.getAudit(auditId).findings.find((x) => x.id === findingId)!;
}

/** Web research for guardrails beyond the registry. Proposals wait for human acceptance. */
export async function research(ws: Workspace, opts: AgentOptions) {
  if (!opts.provider.supportsWebSearch) throw new Error(`${opts.provider.destination} has no web search. Use the Anthropic or OpenAI provider, or let an MCP host research.`);
  const actor = agentActor(opts.provider);
  const scope = ws.scopeView().filter((s) => s.active);
  const proposed: string[] = [];
  const tools = [
    tool({
      name: "propose_rule",
      description: "Propose a requirement for human acceptance, with sources.",
      schema: z.object({
        title: z.string().min(5),
        requirement: z.string().min(20),
        guidance: z.string().min(20).describe("How to verify it in code or repository evidence."),
        severity: z.enum(SEVERITIES),
        category: z.enum(CATEGORIES),
        sources: z.array(z.object({ title: z.string(), url: z.url() })).min(1),
      }),
      run: (r) => {
        const [added] = ws.proposeRules([r], actor);
        proposed.push(added.id);
        return `Proposed ${added.id}.`;
      },
    }),
    tool({ name: "finish", description: "Finish research.", schema: z.object({ summary: z.string() }), run: () => "Done." }),
  ];
  const r = await opts.provider.run({
    system: RESEARCH_SYSTEM,
    prompt: `${productContext(ws)}\n\nFrameworks already in scope:\n${scope.map((s) => `- ${s.shortTitle} (${s.version})`).join("\n") || "- none"}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
    tools,
    webSearch: true,
    maxTurns: opts.maxTurns ?? 20,
    finishTool: "finish",
    onEvent: emit(opts, "research"),
    signal: opts.signal,
  });
  return { proposed, usage: r.usage };
}
