import type { ArtifactId, Category, CheckId, Fixability, Severity } from "./registry/ids";

export type { ArtifactId, Category, CheckId, Fixability, Severity };

/** Who did something. Recorded with every state change in the journal. */
export type Actor = {
  type: "human" | "agent" | "mcp-host" | "system";
  name: string;
};

export type AnswerValue = string | string[] | boolean;

export type CodeRef = {
  path: string;
  line?: number;
  endLine?: number;
  excerpt?: string;
};

export type Answer = {
  value: AnswerValue;
  /** inferred = from code signals, preset = from a preset, human = typed or confirmed by a person. */
  source: "inferred" | "preset" | "human" | "agent";
  confirmed: boolean;
  rationale?: string;
  refs?: CodeRef[];
  at: string;
};

export type Signal = {
  id: string;
  label: string;
  refs: CodeRef[];
};

export type Classification = {
  summary: string;
  productTypes: string[];
  languages: { name: string; files: number }[];
  frameworks: string[];
  signals: Signal[];
  readme?: string;
  /** Free-text purpose written by the agent or a human (what the product is for, who uses it). */
  purpose?: string;
};

export type ScanStats = {
  root: string;
  revision?: string;
  branch?: string;
  dirty?: boolean;
  filesSeen: number;
  filesRead: number;
  bytesRead: number;
  skipped: number;
  truncated: boolean;
  scannedAt: string;
};

export type FrameworkScope = {
  frameworkId: string;
  status: "applies" | "not-applicable" | "unknown";
  /** Human override: include or exclude regardless of the rule. */
  override?: "include" | "exclude";
  reason: string;
  /** Facts that must be answered before the rule can decide. */
  missingFacts: string[];
  /** Facts the decision relies on that are inferred but not yet confirmed by a human. */
  unconfirmedFacts: string[];
};

export type FindingStatus =
  | "open" // proposed by the agent or a check, waiting for a human
  | "confirmed" // human agreed; queued for fixing
  | "rejected" // human disagreed (false positive, accepted risk, not applicable)
  | "reinvestigating" // human asked the agent to look again
  | "withdrawn" // agent concluded on re-investigation that it is not an issue
  | "fixing" // a fix is being produced and verified
  | "fix_ready" // fix applied and verified; waiting for human acceptance
  | "fix_failed" // fix could not be verified; changes rolled back
  | "resolved"; // human accepted the fix (or marked resolved outside Assay)

export type RejectReason =
  | "false-positive"
  | "accepted-risk"
  | "not-applicable"
  | "duplicate"
  | "other";

export type ReviewAction =
  | "confirm"
  | "reject"
  | "modify"
  | "reinvestigate"
  | "reopen"
  | "accept-fix"
  | "revert-fix"
  | "resolve";

export type ReviewEntry = {
  action: ReviewAction | "agent-update" | "fix-attempt";
  by: Actor;
  at: string;
  note?: string;
  reason?: RejectReason;
  changes?: Record<string, { from: unknown; to: unknown }>;
};

export type VerificationRun = {
  command: string;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  output: string; // tail of combined stdout and stderr
  timedOut?: boolean;
};

export type FixRecord = {
  attempts: number;
  summary: string;
  filesChanged: string[];
  diff: string;
  commit?: string;
  branch?: string;
  verification: VerificationRun[];
  recheck?: { checkId: string; stillPresent: boolean; refs: CodeRef[] }[];
  by: Actor;
  startedAt: string;
  finishedAt?: string;
  error?: string;
};

export type Finding = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  category: Category;
  kind: "code" | "configuration" | "dependency" | "missing-artifact" | "process";
  fixability: Fixability;
  controlIds: string[];
  locations: CodeRef[];
  evidence: string;
  recommendation: string;
  confidence: "high" | "medium" | "low";
  source: "check" | "artifact" | "agent" | "mcp-host" | "human";
  checkId?: CheckId;
  artifactId?: ArtifactId;
  /** Stable identity across audits, so decisions carry over when the same issue reappears. */
  fingerprint: string;
  status: FindingStatus;
  /** Extra instructions from the reviewer for the fixer (set via "modify"). */
  fixInstructions?: string;
  reinvestigateNote?: string;
  history: ReviewEntry[];
  fix?: FixRecord;
  createdAt: string;
  updatedAt: string;
};

export type ControlStatus = "gap" | "evidence-present" | "needs-evidence" | "verified" | "attested";

export type ControlAssessment = {
  controlId: string;
  status: ControlStatus;
  findingIds: string[];
  note?: string;
  attestedBy?: Actor;
  at?: string;
};

export type AuditPhase =
  | "created"
  | "scanned"
  | "scoped"
  | "investigating"
  | "review"
  | "fixing"
  | "complete"
  | "failed";

export type Audit = {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: AuditPhase;
  mode: "static" | "agent" | "mcp";
  registryHash: string;
  profileHash: string;
  scan: ScanStats;
  scope: FrameworkScope[];
  findings: Finding[];
  controls: ControlAssessment[];
  /** Agent notes per category, for the report. */
  notes: { category: string; text: string; by: Actor; at: string }[];
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
};

export type ProjectConfig = {
  name: string;
  root: string;
  createdAt: string;
  presetId?: string;
  answers: Record<string, Answer>;
  classification?: Classification;
  scopeOverrides: Record<string, "include" | "exclude">;
  /** Build and test commands. Running them executes project code, so a human approves them. */
  verify: { commands: string[]; approved: boolean; approvedBy?: Actor; timeoutSec: number };
  fix: { useBranch: boolean; branchPrefix: string; maxAttempts: number };
  research: { enabled: boolean };
};

export type JournalEntry = {
  seq: number;
  at: string;
  actor: Actor;
  action: string;
  target?: string;
  data?: unknown;
  prevHash: string;
  hash: string;
};

export type ResearchRule = {
  id: string;
  title: string;
  requirement: string;
  guidance: string;
  severity: Severity;
  category: Category;
  sources: { title: string; url: string }[];
  status: "proposed" | "accepted" | "rejected";
  proposedBy: Actor;
  decidedBy?: Actor;
  at: string;
};
