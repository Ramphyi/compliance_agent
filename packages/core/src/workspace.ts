import { createHash, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { fingerprint, staticAudit } from "./audit/static";
import { changedPaths, commitPaths, currentBranch, diffSince, ensureBranch, head, isGitRepo, restorePaths, revertCommit } from "./fix/git";
import { detectVerifyCommands, runVerification } from "./fix/verify";
import { computeScope, inScope, scopedControls, visibleQuestions } from "./registry/conditions";
import { CATEGORIES, SEVERITIES } from "./registry/ids";
import { frameworkLayers } from "./registry/custom";
import { loadRegistry } from "./registry/load";
import type { Control, Question, Registry } from "./registry/schema";
import { applyReview, availableActions, ReviewError, type ReviewInput, summarize } from "./review";
import { classify } from "./scan/classify";
import { scanProject, type Snapshot } from "./scan/walk";
import { Store } from "./store";
import type {
  Actor, Answer, AnswerValue, Audit, AuditTrigger, Automation, Category, Classification, CodeRef, ControlAssessment, Finding,
  FindingStatus, Fixability, ProjectConfig, ResearchRule, Severity, VerificationRun,
} from "./types";

export type FindingDraft = {
  title: string;
  description: string;
  severity: Severity;
  category: Category;
  kind?: Finding["kind"];
  fixability?: Fixability;
  controlIds?: string[];
  locations?: CodeRef[];
  evidence: string;
  recommendation: string;
  confidence?: Finding["confidence"];
};

export type QuestionView = Question & { answer?: Answer };

export const SYSTEM: Actor = { type: "system", name: "acai" };

const now = () => new Date().toISOString();

export class Workspace {
  readonly root: string;
  readonly store: Store;
  registry: Registry;
  /** Registry files that failed validation; they are skipped and shown in the UI. */
  registryErrors: { file: string; message: string }[] = [];
  private cache?: { snapshot: Snapshot; classification: Classification; inferred: Record<string, Answer> };

  private constructor(root: string, store: Store, registry: Registry) {
    this.root = root;
    this.store = store;
    this.registry = registry;
  }

  static open(root: string, opts: { stateDir?: string; registryRoot?: string } = {}) {
    const abs = resolve(root);
    if (!existsSync(abs)) throw new Error(`Project directory not found: ${abs}`);
    const store = new Store(abs, opts.stateDir);
    const { registry, errors } = loadRegistry(opts.registryRoot, frameworkLayers(store.rulesDir()));
    const ws = new Workspace(abs, store, registry);
    ws.registryErrors = errors;
    return ws;
  }

  /** Re-read the built-in registry, the server's frameworks and this project's rules. */
  reloadRegistry() {
    const { registry, errors } = loadRegistry(this.registry.root, frameworkLayers(this.store.rulesDir()));
    this.registry = registry;
    this.registryErrors = errors;
  }

  // ------------------------------------------------------------------ project

  project(): ProjectConfig {
    return this.store.readProject() ?? this.init();
  }

  /** Read-modify-write of the project config, initialising it on first use. */
  private mutate<T>(fn: (p: ProjectConfig) => T): T {
    this.project();
    return this.store.updateProject(fn);
  }

  init(opts: { name?: string } = {}): ProjectConfig {
    return this.store.withLock(() => {
      const existing = this.store.readProject();
      if (existing) return existing;
      const detected = detectVerifyCommands(this.root);
      const p: ProjectConfig = {
        name: opts.name ?? basename(this.root),
        root: this.root,
        createdAt: now(),
        answers: {},
        scopeOverrides: {},
        verify: { commands: detected.commands, approved: false, timeoutSec: 600 },
        fix: { useBranch: true, branchPrefix: "acai/fixes", maxAttempts: 3 },
        research: { enabled: false },
      };
      this.store.writeProject(p);
      return p;
    });
  }

  // ---------------------------------------------------------- scan / profile

  scan(opts: { refresh?: boolean } = {}) {
    if (!this.cache || opts.refresh) {
      const snapshot = scanProject(this.root);
      const stateRel = relative(this.root, this.store.dir).split("\\").join("/");
      if (stateRel && !stateRel.startsWith(".."))
        snapshot.paths = snapshot.paths.filter((p) => p !== stateRel && !p.startsWith(stateRel + "/"));
      const { classification, inferred } = classify(snapshot);
      this.cache = { snapshot, classification, inferred };
    }
    return this.cache;
  }

  /** Store the classification and add inferred answers for facts nobody answered yet. */
  refreshProfile(actor: Actor = SYSTEM) {
    const { classification, inferred } = this.scan({ refresh: true });
    const added = this.mutate((p) => {
      p.classification = { ...classification, purpose: p.classification?.purpose };
      const added: string[] = [];
      for (const [k, a] of Object.entries(inferred))
        if (!p.answers[k] || (p.answers[k].source === "inferred" && !p.answers[k].confirmed)) {
          if (!p.answers[k]) added.push(k);
          p.answers[k] = a;
        }
      return added;
    });
    this.store.journal(actor, "profile.scanned", undefined, { summary: classification.summary, inferred: added });
    return this.profileView();
  }

  profileView() {
    const p = this.project();
    const questions: QuestionView[] = visibleQuestions(this.registry, p.answers).map((q) => ({ ...q, answer: p.answers[q.id] }));
    const scope = this.scope();
    const missing = [...new Set(scope.filter((s) => s.status === "unknown" && !s.override).flatMap((s) => s.missingFacts))];
    return {
      name: p.name,
      root: this.root,
      classification: p.classification,
      presetId: p.presetId,
      questions,
      presets: this.registry.presets.map((x) => ({ id: x.id, title: x.title, description: x.description })),
      completeness: {
        total: questions.length,
        answered: questions.filter((q) => q.answer).length,
        confirmed: questions.filter((q) => q.answer?.confirmed).length,
        unconfirmed: questions.filter((q) => q.answer && !q.answer.confirmed).map((q) => q.id),
        missingForScope: missing,
      },
      verify: p.verify,
      fix: p.fix,
      research: p.research,
    };
  }

  applyPreset(presetId: string, actor: Actor) {
    const preset = this.registry.presets.find((x) => x.id === presetId);
    if (!preset) throw new Error(`Unknown preset "${presetId}"`);
    this.project();
    this.mutate((p) => {
      p.presetId = preset.id;
      for (const [k, v] of Object.entries(preset.answers))
        p.answers[k] = { value: v, source: "preset", confirmed: actor.type === "human", rationale: `Preset: ${preset.title}`, at: now() };
      for (const id of preset.includeFrameworks) p.scopeOverrides[id] = "include";
      for (const id of preset.excludeFrameworks) p.scopeOverrides[id] = "exclude";
      if (preset.verify.length && !p.verify.approved) p.verify.commands = preset.verify;
    });
    this.store.journal(actor, "profile.preset", presetId);
    return this.profileView();
  }

  setAnswers(values: Record<string, AnswerValue>, actor: Actor, opts: { confirm?: boolean; rationale?: string } = {}) {
    const known = new Map(this.registry.questionnaire.questions.map((q) => [q.id, q]));
    for (const [k, v] of Object.entries(values)) {
      const q = known.get(k);
      if (!q) throw new Error(`Unknown question "${k}"`);
      const allowed = new Set((q.options ?? []).map((o) => o.value));
      const vals = Array.isArray(v) ? v : [v];
      if (q.type === "multi" && !Array.isArray(v)) throw new Error(`"${k}" takes a list of values`);
      if (q.type === "single" && Array.isArray(v)) throw new Error(`"${k}" takes a single value`);
      if (allowed.size) for (const x of vals) if (!allowed.has(String(x))) throw new Error(`"${x}" is not an option for "${k}". Options: ${[...allowed].join(", ")}`);
    }
    this.project();
    const confirmed = opts.confirm ?? actor.type === "human";
    this.mutate((p) => {
      for (const [k, v] of Object.entries(values))
        p.answers[k] = {
          value: v,
          source: actor.type === "human" ? "human" : "agent",
          confirmed,
          rationale: opts.rationale,
          at: now(),
        };
    });
    this.store.journal(actor, "profile.answer", undefined, { values, confirmed });
    return this.profileView();
  }

  confirmAnswers(ids: string[] | "all", actor: Actor) {
    if (actor.type === "agent") throw new ReviewError("Answers must be confirmed by a person");
    const confirmed = this.mutate((p) => {
      const list = ids === "all" ? Object.keys(p.answers) : ids;
      for (const id of list) if (p.answers[id]) p.answers[id] = { ...p.answers[id], confirmed: true, at: now() };
      return list;
    });
    this.store.journal(actor, "profile.confirm", undefined, { ids: confirmed });
    return this.profileView();
  }

  setPurpose(purpose: string, actor: Actor) {
    this.mutate((p) => {
      p.classification = { ...(p.classification ?? this.scan().classification), purpose };
    });
    this.store.journal(actor, "profile.purpose", undefined, { purpose });
  }

  scope() {
    const p = this.project();
    return computeScope(this.registry, p.answers, p.scopeOverrides);
  }

  scopeView() {
    const p = this.project();
    return this.scope().map((s) => {
      const f = this.registry.frameworks.find((x) => x.id === s.frameworkId)!;
      return {
        ...s,
        active: inScope(s),
        title: f.title,
        shortTitle: f.shortTitle,
        version: f.version,
        kind: f.kind,
        authority: f.authority,
        url: f.url,
        jurisdictions: f.jurisdictions,
        controls: scopedControls(this.registry, [{ ...s, override: "include" }], p.answers).length,
        keyDates: f.keyDates,
        origin: f.origin,
        replaces: f.replaces,
      };
    });
  }

  setScopeOverride(frameworkId: string, value: "include" | "exclude" | null, actor: Actor) {
    if (!this.registry.frameworks.some((f) => f.id === frameworkId)) throw new Error(`Unknown framework "${frameworkId}"`);
    this.mutate((p) => {
      if (value) p.scopeOverrides[frameworkId] = value;
      else delete p.scopeOverrides[frameworkId];
    });
    this.store.journal(actor, "scope.override", frameworkId, { value });
  }

  controlsInScope(): Control[] {
    return scopedControls(this.registry, this.scope(), this.project().answers);
  }

  setVerify(commands: string[], opts: { approve: boolean; timeoutSec?: number }, actor: Actor) {
    if (opts.approve && actor.type !== "human" && actor.type !== "mcp-host")
      throw new ReviewError("Build and test commands execute project code; only a person can approve them");
    this.mutate((p) => {
      const changed = JSON.stringify(commands) !== JSON.stringify(p.verify.commands);
      p.verify = {
        commands,
        approved: opts.approve || (p.verify.approved && !changed),
        approvedBy: opts.approve ? actor : changed ? undefined : p.verify.approvedBy,
        timeoutSec: opts.timeoutSec ?? p.verify.timeoutSec,
      };
    });
    this.store.journal(actor, "verify.configure", undefined, { commands, approved: opts.approve });
    return this.project().verify;
  }

  automation(): Automation {
    const a = this.project().automation;
    return {
      push: a?.push ?? "scan",
      pullRequest: a?.pullRequest ?? "scan",
      report: { commitStatus: a?.report?.commitStatus ?? true, prComment: a?.report?.prComment ?? true },
      failOn: a?.failOn ?? "high",
    };
  }

  setAutomation(next: Partial<Automation>, actor: Actor) {
    const current = this.automation();
    const merged: Automation = { ...current, ...next, report: { ...current.report, ...next.report } };
    if (!["off", "scan", "agent"].includes(merged.push) || !["off", "scan"].includes(merged.pullRequest) || !SEVERITIES.includes(merged.failOn))
      throw new ReviewError("Invalid automation settings");
    this.mutate((p) => {
      p.automation = merged;
    });
    this.store.journal(actor, "automation.updated", undefined, merged);
    return merged;
  }

  setFixOptions(opts: Partial<ProjectConfig["fix"]> & { researchEnabled?: boolean }, actor: Actor) {
    this.mutate((p) => {
      const { researchEnabled, ...fix } = opts;
      p.fix = { ...p.fix, ...fix };
      if (researchEnabled !== undefined) p.research.enabled = researchEnabled;
    });
    this.store.journal(actor, "settings.update", undefined, opts);
  }

  // ------------------------------------------------------------------ audits

  listAudits() {
    return this.store.listAudits().map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      phase: a.phase,
      mode: a.mode,
      revision: a.scan.revision,
      summary: summarize(a.findings),
    }));
  }

  getAudit(id?: string): Audit {
    const a = id ? this.store.readAudit(id) : this.store.latestAudit();
    if (!a) throw new Error(id ? `Audit ${id} not found` : "No audit yet. Start one first.");
    return a;
  }

  findingView(f: Finding) {
    const controls = f.controlIds.map((id) => this.registry.controls.get(id)).filter((c): c is Control => Boolean(c));
    return {
      ...f,
      actions: availableActions(f.status),
      controls: controls.map((c) => ({
        id: c.id,
        frameworkId: c.frameworkId,
        framework: c.frameworkTitle,
        frameworkKind: this.registry.frameworks.find((x) => x.id === c.frameworkId)?.kind,
        ref: c.ref,
        title: c.title,
        requirement: c.requirement,
      })),
    };
  }

  private profileHash(p: ProjectConfig) {
    const answers = Object.fromEntries(Object.entries(p.answers).map(([k, a]) => [k, a.value]).sort());
    return createHash("sha256").update(JSON.stringify({ answers, o: p.scopeOverrides })).digest("hex").slice(0, 16);
  }

  /** New audit: fresh scan, deterministic checks, carry-over of earlier human decisions. */
  createAudit(opts: { mode: Audit["mode"]; actor: Actor; trigger?: AuditTrigger }): Audit {
    this.project();
    this.refreshProfile(opts.actor);
    const p = this.project();
    const { snapshot, classification } = this.scan();
    const controls = this.controlsInScope();
    const result = staticAudit(snapshot, classification, controls);
    const prev = this.store.latestAudit();
    const prevByFp = new Map(prev?.findings.map((f) => [f.fingerprint, f]) ?? []);
    const id = `audit-${now().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-")}-${randomBytes(2).toString("hex")}`;

    const findings: Finding[] = [];
    const fresh: Omit<Finding, "id">[] = [];
    for (const f of result.findings) {
      const old = prevByFp.get(f.fingerprint);
      if (!old) {
        fresh.push(f);
        continue;
      }
      const carried = this.carry(old, f);
      findings.push(carried);
    }
    // Agent and human findings cannot be re-detected by checks: keep the unresolved ones.
    const detected = new Set(result.findings.map((f) => f.fingerprint));
    let gone = 0;
    for (const old of prev?.findings ?? []) {
      if (detected.has(old.fingerprint)) continue;
      if (old.source === "check" || old.source === "artifact") {
        if (!["rejected", "resolved", "withdrawn"].includes(old.status)) gone++;
        continue;
      }
      if (old.status === "resolved") continue;
      findings.push({ ...old, status: old.status === "fixing" ? "confirmed" : old.status });
    }
    const numbers = this.reserveFindingNumbers(fresh.length);
    fresh.forEach((f, i) => findings.push({ ...f, id: `F-${String(numbers + i).padStart(3, "0")}` }));

    const idByFp = new Map(findings.map((f) => [f.fingerprint, f.id]));
    const prevControls = new Map(prev?.controls.map((c) => [c.controlId, c]) ?? []);
    const assessments: ControlAssessment[] = result.controls.map((c) => {
      const old = prevControls.get(c.controlId);
      const ids = c.findingIds.map((fp) => idByFp.get(fp)!).filter(Boolean);
      if (c.status !== "gap" && old && (old.status === "attested" || old.status === "verified")) return { ...old, findingIds: [] };
      return { ...c, findingIds: ids };
    });
    for (const f of findings)
      for (const cid of f.controlIds) {
        const a = assessments.find((x) => x.controlId === cid);
        if (a && !a.findingIds.includes(f.id) && !["rejected", "withdrawn", "resolved"].includes(f.status)) {
          a.findingIds.push(f.id);
          a.status = "gap";
        }
      }

    const audit: Audit = {
      id,
      createdAt: now(),
      updatedAt: now(),
      phase: opts.mode === "agent" ? "investigating" : "review",
      mode: opts.mode,
      ...(opts.trigger ? { trigger: opts.trigger } : {}),
      registryHash: this.registry.hash,
      profileHash: this.profileHash(p),
      scan: snapshot.stats,
      scope: this.scope(),
      findings: findings.sort((a, b) => sevOrder(a) - sevOrder(b) || a.id.localeCompare(b.id)),
      controls: assessments,
      notes: gone ? [{ category: "carry-over", text: `${gone} finding(s) from the previous audit are no longer detected.`, by: SYSTEM, at: now() }] : [],
    };
    this.store.writeAudit(audit);
    this.store.journal(opts.actor, "audit.created", id, {
      mode: opts.mode,
      revision: snapshot.stats.revision,
      frameworks: audit.scope.filter(inScope).map((s) => s.frameworkId),
      findings: summarize(findings),
    });
    return audit;
  }

  private carry(old: Finding, f: Omit<Finding, "id">): Finding {
    const modified = old.history.some((h) => h.action === "modify");
    let status: FindingStatus = old.status;
    const history = [...old.history];
    if (old.status === "fix_ready" || old.status === "resolved") {
      status = "open";
      history.push({ action: "agent-update", by: SYSTEM, at: now(), note: "Detected again after it was fixed or resolved." });
    } else if (old.status === "fixing") status = "confirmed";
    return {
      ...f,
      id: old.id,
      status,
      history,
      fix: old.fix,
      fixInstructions: old.fixInstructions,
      reinvestigateNote: old.reinvestigateNote,
      ...(modified ? { title: old.title, description: old.description, severity: old.severity, recommendation: old.recommendation } : {}),
      createdAt: old.createdAt,
    };
  }

  private reserveFindingNumbers(n: number) {
    return this.mutate((p) => {
      const cfg = p as ProjectConfig & { nextFinding?: number };
      const start = cfg.nextFinding ?? 1;
      cfg.nextFinding = start + n;
      return start;
    });
  }

  setPhase(auditId: string, phase: Audit["phase"], extra: Partial<Pick<Audit, "error" | "model" | "usage">> = {}) {
    this.store.updateAudit(auditId, (a) => {
      a.phase = phase;
      Object.assign(a, extra);
    });
  }

  addNote(auditId: string, category: string, text: string, actor: Actor) {
    this.store.updateAudit(auditId, (a) => {
      a.notes.push({ category, text, by: actor, at: now() });
    });
  }

  /** Add findings from the agent, an MCP host or a person. Duplicates (same fingerprint) are merged. */
  addFindings(auditId: string, drafts: FindingDraft[], actor: Actor): Finding[] {
    const inScopeIds = new Set(this.controlsInScope().map((c) => c.id));
    const prepared = drafts.map((d) => {
      if (!(SEVERITIES as readonly string[]).includes(d.severity)) throw new Error(`Invalid severity "${d.severity}"`);
      if (!(CATEGORIES as readonly string[]).includes(d.category)) throw new Error(`Invalid category "${d.category}"`);
      const unknown = (d.controlIds ?? []).filter((c) => !this.registry.controls.has(c));
      if (unknown.length) throw new Error(`Unknown control ids: ${unknown.join(", ")}`);
      const locations = (d.locations ?? []).filter((l) => {
        const abs = resolve(this.root, l.path);
        const rel = relative(this.root, abs);
        return !rel.startsWith("..") && existsSync(abs);
      });
      const fp = fingerprint(actor.type, d.category, locations[0]?.path ?? "", d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
      return { d, locations, fp, outOfScope: (d.controlIds ?? []).filter((c) => !inScopeIds.has(c)) };
    });
    const start = this.reserveFindingNumbers(prepared.length);
    const added = this.store.updateAudit(auditId, (a) => {
      const out: Finding[] = [];
      prepared.forEach(({ d, locations, fp }, i) => {
        const existing = a.findings.find((f) => f.fingerprint === fp);
        if (existing) {
          existing.history.push({ action: "agent-update", by: actor, at: now(), note: "Reported again by the investigation." });
          out.push(existing);
          return;
        }
        // Same issue already reported (same category, a location within a few lines): keep one
        // finding and attach the new evidence to it, instead of asking the reviewer twice.
        const near = (x: CodeRef, y: CodeRef) => x.path === y.path && (x.line === undefined || y.line === undefined || Math.abs(x.line - y.line) <= 3);
        const same = (x: CodeRef, y: CodeRef) => x.path === y.path && x.line !== undefined && x.line === y.line;
        // Same category near the same code, or any category at exactly the same line, is the same issue.
        const overlap = locations.length
          ? a.findings.find(
              (f) =>
                !["rejected", "withdrawn", "resolved"].includes(f.status) &&
                f.locations.some((x) => locations.some((y) => (f.category === d.category && near(x, y)) || same(x, y))),
            )
          : undefined;
        if (overlap) {
          overlap.history.push({ action: "agent-update", by: actor, at: now(), note: `Also found by ${actor.name}: ${d.title}. ${d.evidence}`.slice(0, 1500) });
          overlap.updatedAt = now();
          out.push(overlap);
          return;
        }
        const f: Finding = {
          id: `F-${String(start + i).padStart(3, "0")}`,
          title: d.title,
          description: d.description,
          severity: d.severity,
          category: d.category,
          kind: d.kind ?? "code",
          fixability: d.fixability ?? "code",
          controlIds: d.controlIds ?? [],
          locations,
          evidence: d.evidence,
          recommendation: d.recommendation,
          confidence: d.confidence ?? "medium",
          source: actor.type === "mcp-host" ? "mcp-host" : actor.type === "human" ? "human" : "agent",
          fingerprint: fp,
          status: "open",
          history: [],
          createdAt: now(),
          updatedAt: now(),
        };
        a.findings.push(f);
        for (const cid of f.controlIds) {
          const ca = a.controls.find((c) => c.controlId === cid);
          if (ca) {
            ca.status = "gap";
            ca.findingIds.push(f.id);
          }
        }
        out.push(f);
      });
      a.findings.sort((x, y) => sevOrder(x) - sevOrder(y) || x.id.localeCompare(y.id));
      return out;
    });
    this.store.journal(actor, "finding.added", auditId, { ids: added.map((f) => f.id) });
    return added;
  }

  /** Agent or host remark on a finding (for example "likely false positive"). Never changes status. */
  annotateFinding(auditId: string, findingId: string, note: string, actor: Actor) {
    this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      f.history.push({ action: "agent-update", by: actor, at: now(), note });
      f.updatedAt = now();
    });
    this.store.journal(actor, "finding.annotated", findingId, { note });
  }

  /** Human review decision: confirm, reject, modify, reinvestigate, reopen, accept-fix, revert-fix, resolve. */
  async review(auditId: string, findingId: string, input: ReviewInput, actor: Actor): Promise<Finding> {
    if (input.action === "revert-fix") {
      const f = mustFind(this.getAudit(auditId), findingId);
      if (f.status === "fix_ready" && f.fix?.commit) revertCommit(this.root, f.fix.commit);
    }
    const f = this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      applyReview(f, input, actor);
      if (input.action === "accept-fix" || input.action === "resolve") {
        for (const ca of a.controls)
          if (ca.findingIds.includes(f.id)) {
            ca.findingIds = ca.findingIds.filter((x) => x !== f.id);
            const stillOpen = ca.findingIds.some((id) => {
              const other = a.findings.find((x) => x.id === id);
              return other && !["rejected", "withdrawn", "resolved"].includes(other.status);
            });
            if (!stillOpen) ca.status = "needs-evidence";
          }
      }
      if (a.phase === "complete" && ["reopen", "reinvestigate", "confirm"].includes(input.action)) a.phase = "review";
      return structuredClone(f);
    });
    this.store.journal(actor, `finding.${input.action}`, findingId, { auditId, note: input.note, reason: input.reason, changes: input.changes });
    return f;
  }

  /** Result of a re-investigation by the agent or MCP host. */
  completeReinvestigation(
    auditId: string,
    findingId: string,
    r: { verdict: "still-valid" | "revised" | "withdraw"; note: string; updates?: Partial<FindingDraft> },
    actor: Actor,
  ) {
    const f = this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      if (f.status !== "reinvestigating") throw new ReviewError(`${findingId} is not awaiting re-investigation (status ${f.status})`);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (r.verdict === "revised" && r.updates)
        for (const k of ["title", "description", "severity", "recommendation", "evidence", "locations", "controlIds"] as const) {
          const v = r.updates[k];
          if (v === undefined) continue;
          changes[k] = { from: f[k], to: v };
          (f as Record<string, unknown>)[k] = v;
        }
      f.status = r.verdict === "withdraw" ? "withdrawn" : "open";
      f.history.push({ action: "agent-update", by: actor, at: now(), note: `Re-investigation (${r.verdict}): ${r.note}`, changes: Object.keys(changes).length ? changes : undefined });
      f.updatedAt = now();
      return structuredClone(f);
    });
    this.store.journal(actor, "finding.reinvestigated", findingId, { verdict: r.verdict });
    return f;
  }

  assessControl(auditId: string, controlId: string, status: "verified" | "attested" | "needs-evidence" | "gap", note: string, actor: Actor) {
    if (status === "attested" && actor.type === "agent") throw new ReviewError("Only a person can attest a control");
    if (!this.registry.controls.has(controlId)) throw new Error(`Unknown control "${controlId}"`);
    this.store.updateAudit(auditId, (a) => {
      let ca = a.controls.find((c) => c.controlId === controlId);
      if (!ca) {
        ca = { controlId, status, findingIds: [] };
        a.controls.push(ca);
      }
      if (ca.status === "gap" && status === "verified") throw new ReviewError(`${controlId} has open findings; resolve them first`);
      ca.status = status;
      ca.note = note;
      ca.attestedBy = actor;
      ca.at = now();
    });
    this.store.journal(actor, `control.${status}`, controlId, { auditId, note });
  }

  // -------------------------------------------------------------------- fixes

  verifyConfig() {
    return this.project().verify;
  }

  async runVerify(signal?: AbortSignal): Promise<VerificationRun[]> {
    const v = this.verifyConfig();
    if (!v.commands.length) return [];
    if (!v.approved) throw new ReviewError("Verification commands are not approved yet. A person must approve them because they run project code.");
    return runVerification(this.root, v.commands, v.timeoutSec, signal);
  }

  /** Start fixing a confirmed finding: requires git, a clean tree, and puts work on a fix branch. */
  beginFix(auditId: string, findingId: string, actor: Actor) {
    if (!isGitRepo(this.root)) throw new ReviewError("Fixes need a git repository so every change can be reviewed and reverted. Run `git init` and commit first.");
    const stateRel = relative(this.root, this.store.dir).split("\\").join("/");
    const audit = this.getAudit(auditId);
    const finding = mustFind(audit, findingId);
    if (finding.status === "fixing" && finding.fix && !finding.fix.finishedAt)
      return { finding, base: (finding.fix as typeof finding.fix & { base?: string }).base ?? head(this.root), resumed: true };
    if (!["confirmed", "fix_failed"].includes(finding.status))
      throw new ReviewError(`${findingId} is ${finding.status}. Only confirmed findings are fixed; a person must confirm it first.`);
    const dirty = changedPaths(this.root, stateRel);
    if (dirty.length) throw new ReviewError(`The working tree has uncommitted changes (${dirty.slice(0, 5).join(", ")}). Commit or stash them before fixing.`);
    const p = this.project();
    let branch: string | undefined;
    if (p.fix.useBranch) {
      branch = `${p.fix.branchPrefix}-${auditId.replace(/^audit-/, "")}`;
      ensureBranch(this.root, branch);
    } else branch = currentBranch(this.root);
    const base = head(this.root);
    const f = this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      f.status = "fixing";
      f.fix = { attempts: 0, summary: "", filesChanged: [], diff: "", branch, verification: [], by: actor, startedAt: now() };
      (f.fix as typeof f.fix & { base?: string }).base = base;
      f.history.push({ action: "fix-attempt", by: actor, at: now(), note: `Fix started on ${branch} at ${base.slice(0, 8)}` });
      a.phase = "fixing";
      return structuredClone(f);
    });
    this.store.journal(actor, "fix.started", findingId, { auditId, branch, base });
    return { finding: f, base, resumed: false };
  }

  /**
   * Verify the working-tree changes for a finding: build/test commands, re-run the detector,
   * then commit (fix_ready) or report failure. With `final`, a failure rolls back (fix_failed).
   */
  async completeFix(auditId: string, findingId: string, opts: { summary: string; actor: Actor; final?: boolean; signal?: AbortSignal }) {
    const stateRel = relative(this.root, this.store.dir).split("\\").join("/");
    const audit = this.getAudit(auditId);
    const finding = mustFind(audit, findingId);
    if (finding.status !== "fixing" || !finding.fix) throw new ReviewError(`${findingId} is not being fixed. Call begin_fix first.`);
    const base = (finding.fix as typeof finding.fix & { base?: string }).base ?? head(this.root);
    const files = changedPaths(this.root, stateRel);
    const p = this.project();
    const attempts = finding.fix.attempts + 1;

    let verification: VerificationRun[] = [];
    let error: string | undefined;
    if (!files.length) error = "No files were changed.";
    else if (p.verify.commands.length && !p.verify.approved) error = "Verification commands are not approved; a person must approve them before fixes can be verified.";
    else if (p.verify.commands.length) {
      verification = await runVerification(this.root, p.verify.commands, p.verify.timeoutSec, opts.signal);
      if (verification.some((v) => !v.passed)) error = `Verification failed: ${verification.find((v) => !v.passed)!.command}`;
    }

    let recheck: NonNullable<Finding["fix"]>["recheck"];
    if (!error && (finding.checkId || finding.artifactId)) {
      const { snapshot, classification } = this.scan({ refresh: true });
      const after = staticAudit(snapshot, classification, this.controlsInScope());
      const still = after.findings.find((f) => f.fingerprint === finding.fingerprint);
      recheck = [{ checkId: finding.checkId ?? finding.artifactId!, stillPresent: Boolean(still), refs: still?.locations ?? [] }];
      if (still) error = `The detector still matches: ${still.locations.map((l) => `${l.path}:${l.line ?? ""}`).join(", ") || still.title}`;
    }

    const diff = diffSince(this.root, base, files);
    const retry = Boolean(error) && !opts.final && attempts < p.fix.maxAttempts;
    let commit: string | undefined;
    if (!error) {
      commit = commitPaths(this.root, files, `acai: fix ${findingId} ${finding.title}\n\n${opts.summary}\n\nAcai-Finding: ${findingId}\nAcai-Audit: ${auditId}\nControls: ${finding.controlIds.join(", ") || "none"}\n`);
    } else if (!retry) {
      restorePaths(this.root, base, files);
    }
    const updated = this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      f.fix = {
        ...f.fix!,
        attempts,
        summary: opts.summary,
        filesChanged: files,
        diff,
        commit,
        verification,
        recheck,
        error,
        finishedAt: retry ? undefined : now(),
      };
      f.status = !error ? "fix_ready" : retry ? "fixing" : "fix_failed";
      f.history.push({ action: "fix-attempt", by: opts.actor, at: now(), note: error ? `Attempt ${attempts} failed: ${error}` : `Fix verified and committed ${commit?.slice(0, 8)}` });
      f.updatedAt = now();
      if (!a.findings.some((x) => x.status === "fixing")) a.phase = "review";
      return structuredClone(f);
    });
    this.store.journal(opts.actor, error ? (retry ? "fix.retry" : "fix.failed") : "fix.ready", findingId, { auditId, attempts, commit, files, error });
    return { finding: updated, ok: !error, retry, error, verification };
  }

  abortFix(auditId: string, findingId: string, reason: string, actor: Actor) {
    const stateRel = relative(this.root, this.store.dir).split("\\").join("/");
    const finding = mustFind(this.getAudit(auditId), findingId);
    if (finding.status !== "fixing") throw new ReviewError(`${findingId} is not being fixed`);
    const base = (finding.fix as typeof finding.fix & { base?: string })?.base;
    if (base) restorePaths(this.root, base, changedPaths(this.root, stateRel));
    this.store.updateAudit(auditId, (a) => {
      const f = mustFind(a, findingId);
      f.status = "fix_failed";
      if (f.fix) {
        f.fix.error = reason;
        f.fix.finishedAt = now();
      }
      f.history.push({ action: "fix-attempt", by: actor, at: now(), note: `Fix abandoned: ${reason}` });
      if (!a.findings.some((x) => x.status === "fixing")) a.phase = "review";
    });
    this.store.journal(actor, "fix.aborted", findingId, { auditId, reason });
  }

  // ----------------------------------------------------------------- research

  proposeRules(rules: Omit<ResearchRule, "id" | "status" | "proposedBy" | "at">[], actor: Actor) {
    const added = this.store.updateResearch((list) => {
      const out: ResearchRule[] = [];
      for (const r of rules) {
        if (!r.sources?.length) throw new Error(`Rule "${r.title}" needs at least one source`);
        const rule: ResearchRule = { ...r, id: `R-${String(list.length + 1).padStart(3, "0")}`, status: "proposed", proposedBy: actor, at: now() };
        list.push(rule);
        out.push(rule);
      }
      return out;
    });
    this.store.journal(actor, "research.proposed", undefined, { ids: added.map((r) => r.id) });
    return added;
  }

  decideRule(id: string, decision: "accepted" | "rejected", actor: Actor) {
    if (actor.type === "agent") throw new ReviewError("Only a person can accept researched rules");
    this.store.updateResearch((list) => {
      const r = list.find((x) => x.id === id);
      if (!r) throw new Error(`Rule ${id} not found`);
      r.status = decision;
      r.decidedBy = actor;
    });
    this.writeAcceptedRules();
    this.store.journal(actor, `research.${decision}`, id);
  }

  /** Accepted research rules become a project-local framework, loaded with the registry. */
  private writeAcceptedRules() {
    const accepted = this.store.readResearch().filter((r) => r.status === "accepted");
    const file = "rules/project-research.yaml";
    const doc = {
      id: "project-research",
      title: "Project-specific guardrails from research",
      shortTitle: "Researched guardrails",
      version: now().slice(0, 10),
      authority: "Project (human-accepted research)",
      kind: "guideline",
      jurisdictions: ["project"],
      url: accepted[0]?.sources[0]?.url ?? "https://example.invalid/none",
      textPolicy: "paraphrased",
      summary: "Rules proposed by research and accepted by a reviewer for this project.",
      applicability: { always: true },
      applicabilityNote: "Accepted by a reviewer for this project.",
      controls: accepted.map((r) => ({
        ref: r.id,
        title: r.title,
        requirement: r.requirement,
        category: r.category,
        severity: r.severity,
        fixability: "code",
        guidance: `${r.guidance}\nSources: ${r.sources.map((s) => s.url).join(", ")}`,
        evidence: [],
        checks: [],
        artifacts: [],
        crosswalk: [],
      })),
    };
    if (accepted.length) this.store.writeRaw(file, stringify(doc));
    else rmSync(join(this.store.dir, file), { force: true });
    this.reloadRegistry();
  }

  journal(limit?: number) {
    return this.store.readJournal(limit);
  }
}

function mustFind(a: Audit, id: string) {
  const f = a.findings.find((x) => x.id === id);
  if (!f) throw new Error(`Finding ${id} not found in ${a.id}`);
  return f;
}

const STATUS_ORDER: FindingStatus[] = ["fixing", "reinvestigating", "open", "fix_ready", "fix_failed", "confirmed", "withdrawn", "rejected", "resolved"];
function sevOrder(f: Finding) {
  return STATUS_ORDER.indexOf(f.status) * 10 + SEVERITIES.indexOf(f.severity);
}
