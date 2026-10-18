import { createHash } from "node:crypto";
import { ARTIFACT_BY_ID, detectArtifacts } from "../checks/artifacts";
import { CHECK_BY_ID } from "../checks/rules";
import { type CheckHit, runChecks } from "../checks/run";
import { SEVERITY_RANK, type Severity } from "../registry/ids";
import type { Control } from "../registry/schema";
import type { Snapshot } from "../scan/walk";
import type { ArtifactId, Classification, ControlAssessment, Finding } from "../types";

export const fingerprint = (...parts: string[]) =>
  createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);

const maxSeverity = (a: Severity, b: Severity) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

function controlLabel(controls: Control[]) {
  const names = [...new Set(controls.map((c) => `${c.frameworkTitle} ${c.ref}`))];
  return names.slice(0, 6).join(", ") + (names.length > 6 ? ` and ${names.length - 6} more` : "");
}

export type StaticResult = {
  findings: Omit<Finding, "id">[];
  controls: ControlAssessment[];
  hits: CheckHit[];
};

/**
 * Deterministic audit: detectors and artifact presence mapped to the in-scope controls.
 * Findings come back without ids; the workspace assigns ids and carries over decisions.
 */
export function staticAudit(snapshot: Snapshot, classification: Classification, controls: Control[]): StaticResult {
  const now = new Date().toISOString();
  const hits = runChecks(snapshot, classification);

  const byCheck = new Map<string, Control[]>();
  const byArtifact = new Map<ArtifactId, Control[]>();
  for (const c of controls) {
    for (const id of c.checks) byCheck.set(id, [...(byCheck.get(id) ?? []), c]);
    for (const id of c.artifacts) byArtifact.set(id, [...(byArtifact.get(id) ?? []), c]);
  }

  const findings: Omit<Finding, "id">[] = [];
  for (const hit of hits) {
    const check = CHECK_BY_ID.get(hit.checkId)!;
    const mapped = byCheck.get(hit.checkId) ?? [];
    if (!mapped.length && !check.standalone) continue;
    const severity = check.severity;
    const where = hit.refs.length > 1 ? `${hit.path} (${hit.refs.length} places)` : hit.refs[0].line ? `${hit.path}:${hit.refs[0].line}` : hit.path;
    findings.push({
      title: `${check.title} in ${hit.path.split("/").pop()}`,
      description: check.description,
      severity,
      category: check.category,
      kind: check.kind,
      fixability: "code",
      controlIds: mapped.map((c) => c.id),
      locations: hit.refs,
      evidence:
        `Detector "${check.id}" matched at ${where}.` +
        (mapped.length ? ` Relevant to ${controlLabel(mapped)}.` : " Not mapped to an in-scope framework; reported as a security defect."),
      recommendation: check.recommendation,
      confidence: check.confidence,
      source: "check",
      checkId: hit.checkId,
      fingerprint: fingerprint("check", hit.checkId, hit.path),
      status: "open",
      history: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  const artifacts = detectArtifacts(snapshot, byArtifact.keys(), new Set(classification.signals.map((x) => x.id)));
  for (const [id, res] of artifacts) {
    if (res.present || !res.relevant) continue;
    const def = ARTIFACT_BY_ID.get(id)!;
    const mapped = byArtifact.get(id)!;
    const ceiling = mapped.reduce<Severity>((s, c) => maxSeverity(s, c.severity), "info");
    const severity = SEVERITY_RANK[def.severity] <= SEVERITY_RANK[ceiling] ? def.severity : ceiling;
    const fixability = mapped.some((c) => c.fixability === "document") || !mapped.some((c) => c.fixability === "code") ? "document" : "code";
    findings.push({
      title: `Missing: ${def.title}`,
      description: `No ${def.title.toLowerCase()} was found in the repository. It is expected evidence for ${controlLabel(mapped)}.`,
      severity,
      category: mapped[0].category,
      kind: "missing-artifact",
      fixability,
      controlIds: mapped.map((c) => c.id),
      locations: [],
      evidence: "Searched file names and CI configuration for this artifact; nothing matched. If it exists outside the repository, attest it instead.",
      recommendation: `Create ${def.draftPath} covering: ${def.draftHint}`,
      confidence: "medium",
      source: "artifact",
      artifactId: id,
      fingerprint: fingerprint("artifact", id),
      status: "open",
      history: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  const assessments: ControlAssessment[] = controls.map((c) => {
    const related = findings
      .filter((f) => f.controlIds.includes(c.id))
      .map((f) => f.fingerprint);
    if (related.length) return { controlId: c.id, status: "gap", findingIds: related };
    const arts = c.artifacts.map((a) => artifacts.get(a)).filter((a) => a?.relevant);
    if (arts.length && arts.every((a) => a!.present))
      return { controlId: c.id, status: "evidence-present", findingIds: [], note: arts.flatMap((a) => a!.refs.map((r) => r.path)).slice(0, 4).join(", ") };
    return { controlId: c.id, status: "needs-evidence", findingIds: [] };
  });

  return { findings, controls: assessments, hits };
}
