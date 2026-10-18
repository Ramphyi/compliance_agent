import { SEVERITIES } from "./registry/ids";
import type { Actor, Finding, FindingStatus, RejectReason, ReviewAction } from "./types";

/** Which statuses each human review action may start from. */
export const TRANSITIONS: Record<ReviewAction, { from: FindingStatus[]; to: FindingStatus | "same" }> = {
  confirm: { from: ["open", "withdrawn", "fix_failed", "reinvestigating"], to: "confirmed" },
  reject: { from: ["open", "confirmed", "withdrawn", "fix_failed", "reinvestigating"], to: "rejected" },
  modify: { from: ["open", "confirmed", "withdrawn", "fix_failed"], to: "same" },
  reinvestigate: { from: ["open", "confirmed", "withdrawn", "fix_failed", "rejected"], to: "reinvestigating" },
  reopen: { from: ["rejected", "withdrawn", "resolved", "fix_failed"], to: "open" },
  "accept-fix": { from: ["fix_ready"], to: "resolved" },
  "revert-fix": { from: ["fix_ready"], to: "confirmed" },
  resolve: { from: ["open", "confirmed", "fix_failed"], to: "resolved" },
};

export const EDITABLE_FIELDS = ["title", "description", "severity", "recommendation", "fixInstructions", "fixability"] as const;
export type FindingEdits = Partial<Pick<Finding, (typeof EDITABLE_FIELDS)[number]>>;

export type ReviewInput = {
  action: ReviewAction;
  note?: string;
  reason?: RejectReason;
  /** For "modify": the edited fields. */
  changes?: FindingEdits;
  /** For "modify": also confirm the finding in the same step. */
  confirm?: boolean;
};

export class ReviewError extends Error {}

export function availableActions(status: FindingStatus): ReviewAction[] {
  return (Object.keys(TRANSITIONS) as ReviewAction[]).filter((a) => TRANSITIONS[a].from.includes(status));
}

/** Apply a human decision to a finding in place. Throws ReviewError on an invalid transition. */
export function applyReview(f: Finding, input: ReviewInput, by: Actor) {
  const t = TRANSITIONS[input.action];
  if (!t) throw new ReviewError(`Unknown action "${input.action}"`);
  if (by.type === "agent" || by.type === "system")
    throw new ReviewError("Only a person (directly, or relayed by an MCP host) can review findings");
  if (!t.from.includes(f.status))
    throw new ReviewError(`Cannot ${input.action} a finding that is ${f.status}. Allowed: ${availableActions(f.status).join(", ") || "none"}`);
  if (input.action === "reject" && !input.reason) throw new ReviewError("Reject needs a reason");
  if (input.action === "reinvestigate" && !input.note?.trim()) throw new ReviewError("Re-investigate needs a note telling the agent what to look at");

  const now = new Date().toISOString();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (input.action === "modify") {
    for (const [k, v] of Object.entries(input.changes ?? {})) {
      if (!(EDITABLE_FIELDS as readonly string[]).includes(k) || v === undefined) continue;
      if (k === "severity" && !(SEVERITIES as readonly string[]).includes(String(v))) throw new ReviewError(`Invalid severity "${v}"`);
      const key = k as keyof FindingEdits;
      if (f[key] === v) continue;
      changes[k] = { from: f[key], to: v };
      (f as Record<string, unknown>)[k] = v;
    }
    if (!Object.keys(changes).length && !input.confirm) throw new ReviewError("Modify needs at least one changed field");
    if (input.confirm) f.status = "confirmed";
  } else {
    f.status = t.to as FindingStatus;
  }
  if (input.action === "reinvestigate") f.reinvestigateNote = input.note;
  if (input.action === "accept-fix" && f.fix) f.fix.finishedAt ??= now;
  f.history.push({ action: input.action, by, at: now, note: input.note, reason: input.reason, changes: Object.keys(changes).length ? changes : undefined });
  f.updatedAt = now;
}

export function summarize(findings: Finding[]) {
  const by = (s: FindingStatus) => findings.filter((f) => f.status === s).length;
  return {
    total: findings.length,
    open: by("open"),
    confirmed: by("confirmed"),
    rejected: by("rejected"),
    reinvestigating: by("reinvestigating"),
    withdrawn: by("withdrawn"),
    fixing: by("fixing"),
    fixReady: by("fix_ready"),
    fixFailed: by("fix_failed"),
    resolved: by("resolved"),
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s && !["rejected", "withdrawn", "resolved"].includes(f.status)).length])),
  };
}
