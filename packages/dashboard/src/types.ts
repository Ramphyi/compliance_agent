// Shapes returned by the Acai API (packages/cli/src/server.ts, packages/core/src/workspace.ts).
// Kept in sync by hand: the dashboard has no build-time dependency on @acai/core.

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = [
  "open", "reinvestigating", "confirmed", "fixing", "fix_ready", "fix_failed", "resolved", "rejected", "withdrawn",
] as const;
export type FindingStatus = (typeof STATUSES)[number];

export type ReviewAction = "confirm" | "reject" | "modify" | "reinvestigate" | "reopen" | "accept-fix" | "revert-fix" | "resolve";
export const REJECT_REASONS = ["false-positive", "accepted-risk", "not-applicable", "duplicate", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export type Fixability = "code" | "document" | "process";

export type Actor = { type: "human" | "agent" | "mcp-host" | "system"; name: string };
export type CodeRef = { path: string; line?: number; endLine?: number; excerpt?: string };
export type AnswerValue = string | string[] | boolean;

export type Answer = {
  value: AnswerValue;
  source: "inferred" | "preset" | "human" | "agent";
  confirmed: boolean;
  rationale?: string;
  refs?: CodeRef[];
  at: string;
};

export type Question = {
  id: string;
  section: string;
  type: "single" | "multi" | "text" | "boolean";
  text: string;
  why: string;
  help?: string;
  options?: { value: string; label: string; help?: string }[];
  answer?: Answer;
};

export type Classification = {
  summary: string;
  productTypes: string[];
  languages: { name: string; files: number }[];
  frameworks: string[];
  signals: { id: string; label: string; refs: CodeRef[] }[];
  purpose?: string;
};

export type VerifyConfig = { commands: string[]; approved: boolean; approvedBy?: Actor; timeoutSec: number };
export type FixOptions = { useBranch: boolean; branchPrefix: string; maxAttempts: number };

export type Profile = {
  name: string;
  root: string;
  classification?: Classification;
  presetId?: string;
  questions: Question[];
  presets: { id: string; title: string; description: string }[];
  completeness: { total: number; answered: number; confirmed: number; unconfirmed: string[]; missingForScope: string[] };
  verify: VerifyConfig;
  fix: FixOptions;
  research: { enabled: boolean };
};

export type ScopeRow = {
  frameworkId: string;
  status: "applies" | "not-applicable" | "unknown";
  override?: "include" | "exclude";
  reason: string;
  missingFacts: string[];
  unconfirmedFacts: string[];
  active: boolean;
  title: string;
  shortTitle: string;
  version: string;
  kind: string;
  authority: string;
  url: string;
  jurisdictions: string[];
  controls: number;
  keyDates: { date: string; note: string }[];
};

export type FrameworkDetail = Omit<ScopeRow, "frameworkId" | "status" | "reason" | "missingFacts" | "unconfirmedFacts" | "active" | "controls" | "override"> & {
  id: string;
  summary: string;
  applicabilityNote: string;
  controls: { id: string; ref: string; title: string; requirement: string; category: string; severity: Severity; fixability: Fixability; guidance: string }[];
};

export type ReviewEntry = {
  action: ReviewAction | "agent-update" | "fix-attempt";
  by: Actor;
  at: string;
  note?: string;
  reason?: RejectReason;
  changes?: Record<string, { from: unknown; to: unknown }>;
};

export type VerificationRun = { command: string; exitCode: number | null; passed: boolean; durationMs: number; output: string; timedOut?: boolean };

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
  category: string;
  kind: "code" | "configuration" | "dependency" | "missing-artifact" | "process";
  fixability: Fixability;
  controlIds: string[];
  locations: CodeRef[];
  evidence: string;
  recommendation: string;
  confidence: "high" | "medium" | "low";
  source: "check" | "artifact" | "agent" | "mcp-host" | "human";
  checkId?: string;
  artifactId?: string;
  status: FindingStatus;
  fixInstructions?: string;
  reinvestigateNote?: string;
  history: ReviewEntry[];
  fix?: FixRecord;
  createdAt: string;
  updatedAt: string;
  // added by findingView()
  actions: ReviewAction[];
  controls: { id: string; framework: string; ref: string; title: string; requirement: string }[];
};

export type Summary = {
  total: number;
  open: number;
  confirmed: number;
  rejected: number;
  reinvestigating: number;
  withdrawn: number;
  fixing: number;
  fixReady: number;
  fixFailed: number;
  resolved: number;
  bySeverity: Record<Severity, number>;
};

export type ControlStatus = "gap" | "evidence-present" | "needs-evidence" | "verified" | "attested";
export const CONTROL_STATUSES: ControlStatus[] = ["gap", "needs-evidence", "evidence-present", "verified", "attested"];
export type ControlAssessment = { controlId: string; status: ControlStatus; findingIds: string[]; note?: string; attestedBy?: Actor; at?: string };

export type Audit = {
  id: string;
  createdAt: string;
  updatedAt: string;
  phase: string;
  mode: "static" | "agent" | "mcp";
  scan: { revision?: string; branch?: string; dirty?: boolean; filesSeen: number; filesRead: number };
  scope: { frameworkId: string; status: string; override?: string }[];
  findings: Finding[];
  controls: ControlAssessment[];
  notes: { category: string; text: string; by: Actor; at: string }[];
  model?: string;
  error?: string;
  trigger?: { source: "webhook"; provider: string; event: string; ref?: string; sha?: string; url?: string };
  summary: Summary;
};

export type AuditListItem = { id: string; createdAt: string; phase: string; mode: string; revision?: string; summary: Summary };

export type ProjectListItem = {
  id: string;
  name: string;
  root: string;
  rulesDir?: string;
  addedAt: string;
  classification?: string;
  latest?: { id: string; createdAt: string; phase: string; summary: Summary } | null;
  running?: string;
};

export type Provider = { id: string; model: string; destination: string; webSearch: boolean };

// ------------------------------------------------------------------ accounts
export type Role = "admin" | "member" | "viewer";
export type AccountRef = { id: string; name: string; role: Role };
export type UserInfo = {
  id: string;
  name: string;
  role: Role;
  disabled: boolean;
  source: "local" | "env";
  createdAt: string;
  lastSeenAt?: string;
  tokens: number;
  sessions: number;
};
export type TokenInfo = {
  id: string;
  userId: string;
  userName: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
};
export type AuthEvent = { at: string; actor: string; action: string; target?: string; ip?: string };
export type AccountInfo = { account: UserInfo; tokens: TokenInfo[] };
export type NewToken = { token: string; info: TokenInfo };
export type ServerInfo = {
  version: string;
  uptimeSec: number;
  node: string;
  authMode: string;
  publicUrl?: string;
  oauth: boolean;
  trustProxy: boolean;
  webhookSecret: boolean;
  githubToken: boolean;
  allowClone: boolean;
  projectRoots: string[];
  approvers: string[];
  admins?: string[];
  dataDir: string;
  provider: { id: string; model: string } | null;
  projects: number;
};

export type Meta = {
  name: string;
  version: string;
  user: string;
  /** "none": local single-user mode; "tokens": accounts with access tokens. */
  auth: "none" | "tokens";
  /** The signed-in account in "tokens" mode. */
  account?: AccountRef | null;
  provider: Provider | null;
  providerError?: string;
  registry: { frameworks: number; controls: number; presets: number; hash: string; errors: { file: string; message: string }[] } | null;
  cloneEnabled: boolean;
};

export type JobStatus = "running" | "done" | "failed" | "cancelled";
export type JobEvent = { at: string; stage?: string } & (
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown; result: string; isError: boolean }
  | { type: "search"; query: string }
  | { type: "turn"; turn: number; inputTokens: number; outputTokens: number }
  | { type: "notice"; message: string }
  | { type: "status"; status: JobStatus; error?: string }
);

export type Job = {
  id: string;
  kind: string;
  projectId: string;
  auditId?: string;
  findingId?: string;
  title: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  events: JobEvent[];
  result?: unknown;
};
export type JobListItem = Omit<Job, "events"> & { lastEvent?: JobEvent };

export type JournalEntry = { seq: number; at: string; actor: Actor; action: string; target?: string; data?: unknown; hash: string; prevHash: string };
export type Journal = { entries: JournalEntry[]; integrity: { ok: boolean; entries: number; brokenAt?: number } };

export type ResearchRule = {
  id: string;
  title: string;
  requirement: string;
  guidance: string;
  severity: Severity;
  category: string;
  sources: { title: string; url: string }[];
  status: "proposed" | "accepted" | "rejected";
  proposedBy: Actor;
  decidedBy?: Actor;
  at: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  "testing-verification": "Testing and verification", "authentication-access": "Authentication and access",
  "privacy-rights": "Privacy rights and notices", "updates-maintenance": "Updates and maintenance",
  "communications-security": "Communications security", "resilience-availability": "Resilience and availability",
  "ai-governance": "AI governance", "ai-security": "AI security", "transparency-documentation": "Transparency and documentation",
};
export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, " ");

export const STATUS_LABELS: Record<FindingStatus, string> = {
  open: "Open", confirmed: "Confirmed", rejected: "Rejected", reinvestigating: "Re-investigating", withdrawn: "Withdrawn",
  fixing: "Fixing", fix_ready: "Fix ready", fix_failed: "Fix failed", resolved: "Resolved",
};

// ------------------------------------------------------------- connect agents
/** Text uses `backticks` for inline code; code blocks are copied as they are. */
export type GuideBlock = { kind: "text"; text: string } | { kind: "steps"; items: string[] } | { kind: "code"; label: string; text: string };
export type Guide = { client: string; label: string; mode: "local" | "remote"; blocks: GuideBlock[] };
export type ConnectInfo = {
  container: boolean;
  mcpUrl: string;
  publicUrl: string | null;
  auth: Meta["auth"];
  oauth: boolean;
  bundleBuilt: boolean;
  stdioCommand: string[];
  project?: { id: string; name: string; root: string };
  clients: { id: string; label: string; remoteOnly: boolean; local: Guide | null; remote: Guide }[];
};

export type RegistryInfo = {
  hash: string;
  root: string;
  ruleTemplate: string | null;
  batches: { id: string; title: string }[];
  frameworks: { id: string; shortTitle: string; title: string; kind: string; version: string; jurisdictions: string[]; controlCount: number }[];
  presets: { id: string; title: string; description: string }[];
  checks: { id: string; title: string }[];
  artifacts: { id: string; title: string }[];
};

// ------------------------------------------------------------------ model
export type ProviderPresetInfo = {
  id: string;
  label: string;
  engine: "anthropic" | "openai" | "openai-compatible";
  baseURL?: string;
  keyEnv?: string;
  needsKey: boolean;
  defaultModel?: string;
  webSearch: boolean;
  local?: boolean;
  docs?: string;
  keyInEnvironment: boolean;
};
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ModelState = {
  active: { preset: string; model: string; destination: string; webSearch: boolean } | null;
  source: "settings" | "environment" | "none";
  error: string | null;
  locked: boolean;
  inContainer: boolean;
  saved: { preset: string; model?: string; baseURL?: string; effort?: Effort; hasKey: boolean } | null;
  presets: ProviderPresetInfo[];
};

// ------------------------------------------------------------- automation
export type Automation = {
  push: "off" | "scan" | "agent";
  pullRequest: "off" | "scan";
  report: { commitStatus: boolean; prComment: boolean };
  failOn: Severity;
};
export type Delivery = {
  id: string;
  at: string;
  provider: string;
  event: string;
  repo: string;
  sha?: string;
  status: "queued" | "running" | "done" | "ignored" | "skipped" | "failed";
  message: string;
  auditId?: string;
  pr?: { number: number; added: number; fixed: number; known: number; url?: string };
  reported?: string[];
};
export type AutomationInfo = {
  settings: Automation;
  publicUrl: string | null;
  secretSet: boolean;
  githubToken: boolean;
  model: boolean;
  origin?: string;
  branch?: string;
  deliveries: Delivery[];
};
