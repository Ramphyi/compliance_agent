import { CATEGORY_LABELS, SEVERITIES } from "./registry/ids";
import { inScope } from "./registry/conditions";
import { summarize } from "./review";
import type { Audit, Finding } from "./types";
import type { Workspace } from "./workspace";

const CLOSED = new Set(["rejected", "withdrawn", "resolved"]);

const loc = (f: Finding) =>
  f.locations.map((l) => `\`${l.path}${l.line ? `:${l.line}` : ""}\``).join(", ");

export function markdownReport(ws: Workspace, audit: Audit): string {
  const p = ws.project();
  const s = summarize(audit.findings);
  const scope = audit.scope;
  const fw = (id: string) => ws.registry.frameworks.find((f) => f.id === id);
  const active = scope.filter(inScope);
  const unknown = scope.filter((x) => x.status === "unknown" && !x.override);
  const out: string[] = [];
  out.push(`# Compliance audit: ${p.name}`, "");
  out.push(
    `| | |`,
    `| --- | --- |`,
    `| Audit | \`${audit.id}\` (${audit.mode}) |`,
    `| Date | ${audit.createdAt} |`,
    `| Revision | ${audit.scan.revision ? `\`${audit.scan.revision.slice(0, 12)}\`${audit.scan.dirty ? " (uncommitted changes)" : ""}` : "not a git checkout"} |`,
    `| Files read | ${audit.scan.filesRead} of ${audit.scan.filesSeen}${audit.scan.truncated ? " (limits reached)" : ""} |`,
    `| Registry | \`${audit.registryHash}\` |`,
    audit.model ? `| Model | ${audit.model}${audit.usage ? ` (${audit.usage.inputTokens} in / ${audit.usage.outputTokens} out tokens)` : ""} |` : "",
    "",
  );
  out.push("## Product", "", p.classification?.purpose ?? p.classification?.summary ?? "Not described.", "");
  const answers = Object.entries(p.answers);
  if (answers.length) {
    out.push("| Fact | Answer | Status |", "| --- | --- | --- |");
    for (const [k, a] of answers)
      out.push(`| ${k} | ${Array.isArray(a.value) ? a.value.join(", ") : String(a.value)} | ${a.confirmed ? "confirmed" : `unconfirmed (${a.source})`} |`);
    out.push("");
  }
  out.push("## Scope", "");
  for (const x of active) {
    const f = fw(x.frameworkId);
    out.push(`- **${f?.shortTitle ?? x.frameworkId}** (${f?.version ?? ""})${x.override ? ` — included manually` : ""}: ${x.reason.split("\n")[0]}`);
  }
  if (unknown.length) {
    out.push("", "Undecided until these facts are answered:", "");
    for (const x of unknown) out.push(`- ${fw(x.frameworkId)?.shortTitle ?? x.frameworkId}: ${x.missingFacts.join(", ")}`);
  }
  out.push("", "## Summary", "");
  out.push(
    `${s.total} findings: ${s.open} awaiting review, ${s.confirmed} confirmed, ${s.fixReady} fixed and awaiting acceptance, ${s.resolved} resolved, ${s.rejected} rejected, ${s.withdrawn} withdrawn, ${s.fixFailed} fix failed.`,
    "",
    `Open by severity: ${SEVERITIES.map((v) => `${v} ${s.bySeverity[v]}`).join(", ")}.`,
    "",
  );
  out.push("## Findings", "");
  for (const f of audit.findings) {
    out.push(`### ${f.id} · ${f.title}`, "");
    out.push(`**${f.severity}** · ${CATEGORY_LABELS[f.category]} · status **${f.status}** · source ${f.source} · confidence ${f.confidence}`, "");
    if (f.controlIds.length)
      out.push(
        `Controls: ${f.controlIds
          .map((id) => {
            const c = ws.registry.controls.get(id);
            return c ? `${c.frameworkTitle} ${c.ref}` : id;
          })
          .join("; ")}`,
        "",
      );
    if (f.locations.length) out.push(`Locations: ${loc(f)}`, "");
    out.push(f.description, "", `*Evidence:* ${f.evidence}`, "", `*Recommendation:* ${f.recommendation}`, "");
    if (f.fixInstructions) out.push(`*Reviewer instructions:* ${f.fixInstructions}`, "");
    if (f.fix)
      out.push(
        `*Fix:* ${f.fix.summary || "in progress"}${f.fix.commit ? ` (commit \`${f.fix.commit.slice(0, 10)}\` on \`${f.fix.branch}\`)` : ""}. ` +
          `Verification: ${f.fix.verification.length ? f.fix.verification.map((v) => `\`${v.command}\` ${v.passed ? "passed" : "failed"}`).join(", ") : "none configured"}.` +
          (f.fix.error ? ` Error: ${f.fix.error}` : ""),
        "",
      );
    const decisions = f.history.filter((h) => h.by.type === "human" || h.by.type === "mcp-host");
    if (decisions.length) {
      out.push("Decisions:", "");
      for (const h of decisions) out.push(`- ${h.at.slice(0, 16).replace("T", " ")} ${h.by.name} (${h.by.type}): ${h.action}${h.reason ? ` [${h.reason}]` : ""}${h.note ? ` — ${h.note}` : ""}`);
      out.push("");
    }
  }
  out.push("## Control coverage", "");
  out.push("| Framework | Controls | Gap | Evidence present | Verified / attested | Needs evidence |", "| --- | --- | --- | --- | --- | --- |");
  for (const x of active) {
    const cs = audit.controls.filter((c) => c.controlId.startsWith(x.frameworkId + ":"));
    const n = (st: string[]) => cs.filter((c) => st.includes(c.status)).length;
    out.push(`| ${fw(x.frameworkId)?.shortTitle ?? x.frameworkId} | ${cs.length} | ${n(["gap"])} | ${n(["evidence-present"])} | ${n(["verified", "attested"])} | ${n(["needs-evidence"])} |`);
  }
  if (audit.notes.length) {
    out.push("", "## Notes", "");
    for (const n of audit.notes) out.push(`- (${n.category}) ${n.text}`);
  }
  const j = ws.store.verifyJournal();
  out.push("", "## Audit trail", "", `${j.entries} journal entries, hash chain ${j.ok ? "intact" : `BROKEN at entry ${j.brokenAt}`}.`, "");
  out.push(
    "---",
    "",
    "_Acai maps code and repository evidence to requirements. It does not provide legal advice or certification. Findings marked unconfirmed or needs-evidence require review by qualified people._",
  );
  return out.filter((l) => l !== undefined).join("\n");
}

export function sarifReport(ws: Workspace, audit: Audit) {
  const level = (sev: string) => (sev === "critical" || sev === "high" ? "error" : sev === "medium" ? "warning" : "note");
  const open = audit.findings.filter((f) => !CLOSED.has(f.status));
  const ruleIds = [...new Set(open.map((f) => f.checkId ?? f.artifactId ?? `finding/${f.category}`))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Acai",
            informationUri: "https://github.com/Ramphyi/compliance_agent",
            rules: ruleIds.map((id) => {
              const f = open.find((x) => (x.checkId ?? x.artifactId ?? `finding/${x.category}`) === id)!;
              return { id, shortDescription: { text: f.title }, fullDescription: { text: f.description }, help: { text: f.recommendation } };
            }),
          },
        },
        versionControlProvenance: audit.scan.revision ? [{ repositoryUri: ".", revisionId: audit.scan.revision }] : undefined,
        results: open.map((f) => ({
          ruleId: f.checkId ?? f.artifactId ?? `finding/${f.category}`,
          level: level(f.severity),
          message: { text: `${f.id} ${f.title}: ${f.description}\nControls: ${f.controlIds.join(", ") || "none"}\nStatus: ${f.status}` },
          locations: (f.locations.length ? f.locations : [{ path: "." }]).map((l) => ({
            physicalLocation: {
              artifactLocation: { uri: l.path },
              ...(l.line ? { region: { startLine: l.line, ...(l.endLine ? { endLine: l.endLine } : {}) } } : {}),
            },
          })),
          partialFingerprints: { acaiFingerprint: f.fingerprint },
          properties: { acaiId: f.id, status: f.status, severity: f.severity, controls: f.controlIds },
        })),
      },
    ],
  };
}

export function report(ws: Workspace, auditId: string | undefined, format: "md" | "json" | "sarif") {
  const audit = ws.getAudit(auditId);
  if (format === "md") return markdownReport(ws, audit);
  if (format === "sarif") return JSON.stringify(sarifReport(ws, audit), null, 2);
  return JSON.stringify({ project: ws.project(), audit }, null, 2);
}

/** CI gate: fail when unresolved findings at or above a severity remain. */
export function gate(audit: Audit, failOn: (typeof SEVERITIES)[number] = "high") {
  const threshold = SEVERITIES.indexOf(failOn);
  const blocking = audit.findings.filter((f) => !CLOSED.has(f.status) && SEVERITIES.indexOf(f.severity) <= threshold);
  return { passed: blocking.length === 0, blocking };
}
