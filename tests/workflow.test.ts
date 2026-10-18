import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Actor, fixFinding, gate, investigate, reinvestigate, report, ReviewError, Workspace } from "../packages/core/src/index";
import { exampleRepo, ScriptedProvider } from "./helpers";

const alice: Actor = { type: "human", name: "alice" };
const agent: Actor = { type: "agent", name: "assay-agent/test" };

describe("audit → human review → fix → verify, on the brake ECU example", () => {
  const repo = exampleRepo("brake-ecu");
  let ws: Workspace;
  let auditId: string;
  const byCheck = (id: string) => ws.getAudit(auditId).findings.find((f) => f.checkId === id)!;
  const byArtifact = (id: string) => ws.getAudit(auditId).findings.find((f) => f.artifactId === id)!;

  beforeAll(() => {
    ws = Workspace.open(repo.dir);
  });
  afterAll(() => repo.cleanup());

  it("classifies the product and applies a preset the human confirms", () => {
    const view = ws.refreshProfile(alice);
    expect(view.classification?.productTypes).toContain("automotive-ecu");
    ws.applyPreset("automotive-ecu-asil-b", alice);
    ws.confirmAnswers("all", alice);
    expect(ws.profileView().completeness.unconfirmed).toEqual([]);
    const active = ws.scopeView().filter((s) => s.active).map((s) => s.frameworkId);
    expect(active).toEqual(expect.arrayContaining(["iso-26262", "misra-c"]));
    expect(active).not.toContain("gdpr");
  });

  it("runs a detector audit mapped to the in-scope controls", () => {
    const audit = ws.createAudit({ mode: "static", actor: alice });
    auditId = audit.id;
    const checks = audit.findings.map((f) => f.checkId).filter(Boolean);
    expect(checks).toEqual(expect.arrayContaining(["uds-weak-security-access", "can-unauthenticated", "goto-statement", "dynamic-memory-embedded"]));
    const goto = byCheck("goto-statement");
    expect(goto.controlIds.some((c) => c.startsWith("misra-c:"))).toBe(true);
    expect(goto.status).toBe("open");
  });

  it("enforces who may decide, and which transitions are allowed", async () => {
    const f = byCheck("goto-statement");
    await expect(ws.review(auditId, f.id, { action: "confirm" }, agent)).rejects.toThrow(ReviewError);
    await expect(ws.review(auditId, f.id, { action: "accept-fix" }, alice)).rejects.toThrow(/Cannot accept-fix/);
    await expect(ws.review(auditId, f.id, { action: "reject" }, alice)).rejects.toThrow(/reason/);
    await expect(ws.review(auditId, f.id, { action: "reinvestigate" }, alice)).rejects.toThrow(/note/);
  });

  it("records confirm, reject and modify decisions", async () => {
    await ws.review(auditId, byCheck("goto-statement").id, { action: "confirm", note: "Replace with early returns" }, alice);
    await ws.review(auditId, byArtifact("third-party-notices").id, { action: "reject", reason: "not-applicable", note: "No third-party code ships in this ECU" }, alice);
    const modified = await ws.review(
      auditId,
      byArtifact("changelog").id,
      { action: "modify", changes: { severity: "medium", fixInstructions: "Start the changelog at 1.4.0 and call out security fixes." }, confirm: true },
      alice,
    );
    expect(modified.status).toBe("confirmed");
    expect(modified.history.at(-1)?.changes?.severity).toEqual({ from: "low", to: "medium" });
  });

  it("re-investigates on request and lets the agent withdraw a finding", async () => {
    const f = byCheck("dynamic-memory-embedded");
    await ws.review(auditId, f.id, { action: "reinvestigate", note: "Is this allocation only at start-up?" }, alice);
    const provider = new ScriptedProvider([
      [
        [{ tool: "read_file", input: { path: f.locations[0].path } }],
        [{ tool: "conclude", input: { verdict: "still-valid", note: "The allocation happens in the 5 ms cyclic task, not only at start-up." } }],
      ],
    ]);
    const after = await reinvestigate(ws, auditId, f.id, { provider });
    expect(after.status).toBe("open");
    expect(after.history.at(-1)?.note).toMatch(/cyclic task/);
    expect(provider.results[0].content).toContain("malloc");
  });

  it("refuses to fix before a person approves the build and test commands", async () => {
    const provider = new ScriptedProvider([]);
    await expect(fixFinding(ws, auditId, byCheck("goto-statement").id, { provider })).rejects.toThrow(/Approve/);
    ws.setVerify(["make all", "make test"], { approve: true }, alice);
  });

  it("fixes a confirmed finding: failed attempt is retried, then verified and committed", async () => {
    const f = byCheck("goto-statement");
    const path = "src/can_tx.c";
    const provider = new ScriptedProvider([
      // Attempt 1 breaks the build (missing semicolon): verification must catch it.
      [[{ tool: "edit_file", input: { path, old_string: "    if (plt_can_send(&status) != 0)\n        goto fail;", new_string: "    if (plt_can_send(&status) != 0)\n        return -1" } }], [{ tool: "finish_fix", input: { summary: "first try" } }]],
      // Attempt 2 completes the change correctly.
      [
        [{ tool: "edit_file", input: { path, old_string: "        return -1\n", new_string: "        return -1;\n" } }],
        [{ tool: "edit_file", input: { path, old_string: "    if (plt_can_send(&pressure) != 0)\n        goto fail;\n\n    rc = 0;\nfail:\n    return rc;", new_string: "    if (plt_can_send(&pressure) != 0)\n        return -1;\n\n    return 0;" } }],
        [{ tool: "edit_file", input: { path, old_string: "    int rc = -1;\n", new_string: "" } }],
        [{ tool: "run_verification", input: {} }],
        [{ tool: "finish_fix", input: { summary: "Replaced goto-based error handling with early returns (MISRA C Rule 15.1)." } }],
      ],
    ]);
    const done = await fixFinding(ws, auditId, f.id, { provider });
    expect(done.status).toBe("fix_ready");
    expect(done.fix?.attempts).toBe(2);
    expect(done.fix?.verification.every((v) => v.passed)).toBe(true);
    expect(done.fix?.recheck?.[0].stillPresent).toBe(false);
    expect(done.fix?.diff).toContain("-        goto fail;");
    expect(repo.git("log", "--oneline", "-1")).toContain(`assay: fix ${f.id}`);
    expect(repo.git("rev-parse", "--abbrev-ref", "HEAD").trim()).toMatch(/^assay\/fixes-/);
    expect(readFileSync(join(repo.dir, path), "utf8")).not.toContain("goto");
  });

  it("drafts a missing document as a fix, then the human accepts or reverts", async () => {
    const f = byArtifact("changelog");
    const provider = new ScriptedProvider([
      [[{ tool: "write_file", input: { path: "CHANGELOG.md", content: "# Changelog\n\n## 1.4.0 — [OWNER TO CONFIRM: release date]\n\n### Security\n- [OWNER TO CONFIRM]\n" } }], [{ tool: "finish_fix", input: { summary: "Drafted CHANGELOG.md for the owner to complete." } }]],
    ]);
    const done = await fixFinding(ws, auditId, f.id, { provider });
    expect(done.status).toBe("fix_ready");
    const reverted = await ws.review(auditId, f.id, { action: "revert-fix", note: "Release notes live in the OEM portal" }, alice);
    expect(reverted.status).toBe("confirmed");
    expect(repo.git("log", "--oneline", "-1")).toMatch(/Revert/);
    const accepted = await ws.review(auditId, byCheck("goto-statement").id, { action: "accept-fix" }, alice);
    expect(accepted.status).toBe("resolved");
  });

  it("carries decisions into the next audit and drops what was fixed", () => {
    const next = ws.createAudit({ mode: "static", actor: alice });
    expect(next.findings.find((f) => f.checkId === "goto-statement")).toBeUndefined();
    const notices = next.findings.find((f) => f.artifactId === "third-party-notices");
    expect(notices?.status).toBe("rejected");
    expect(next.findings.find((f) => f.artifactId === "changelog")?.status).toBe("confirmed");
    auditId = next.id;
  });

  it("keeps an intact, hash-chained journal and produces reports", () => {
    expect(ws.store.verifyJournal().ok).toBe(true);
    const actions = ws.journal().map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["finding.confirm", "finding.reject", "finding.modify", "fix.ready", "fix.retry", "finding.accept-fix"]));
    const md = report(ws, auditId, "md");
    expect(md).toContain("ISO 26262");
    expect(md).toContain("hash chain intact");
    const sarif = JSON.parse(report(ws, auditId, "sarif"));
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    expect(gate(ws.getAudit(auditId), "high").passed).toBe(false);
  });

  it("detects tampering with the journal", () => {
    const file = join(ws.store.dir, "journal.jsonl");
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    const entry = JSON.parse(lines[2]);
    entry.actor.name = "mallory";
    lines[2] = JSON.stringify(entry);
    writeFileSync(file, lines.join("\n") + "\n");
    expect(ws.store.verifyJournal()).toMatchObject({ ok: false, brokenAt: 3 });
  });
});

describe("agent investigation adds evidence-based findings", () => {
  const repo = exampleRepo("credit-scoring-ml");
  afterAll(() => repo.cleanup());

  it("records findings mapped to in-scope controls and rejects unknown ones", async () => {
    const ws = Workspace.open(repo.dir);
    ws.applyPreset("ai-credit-scoring-eu", alice);
    ws.confirmAnswers("all", alice);
    const audit = ws.createAudit({ mode: "agent", actor: alice });
    const control = ws.controlsInScope().find((c) => c.id.startsWith("eu-ai-act:") && /human oversight/i.test(c.title))!;
    expect(control).toBeDefined();
    // Only the "ai" batch runs, so the provider gets exactly one script.
    const provider = new ScriptedProvider([
[
              [{ tool: "search", input: { pattern: "decline|approve", glob: "app/**" } }],
              [
                {
                  tool: "record_finding",
                  input: {
                    title: "Loan declines are fully automated with no human review",
                    description: "Applications below the threshold are declined automatically; no reviewer can intervene.",
                    severity: "high",
                    category: control.category,
                    kind: "code",
                    fixability: "code",
                    control_ids: [control.id],
                    locations: [{ path: "app/scoring.py", line: 1 }],
                    evidence: "Searched app/ for review queues or override paths; none exist.",
                    recommendation: "Route declines to a review queue and let a credit officer override.",
                    confidence: "high",
                  },
                },
                { tool: "record_finding", input: { title: "Bogus", description: "x".repeat(20), severity: "low", category: "governance", kind: "process", fixability: "process", control_ids: ["made-up:1"], locations: [], evidence: "x".repeat(20), recommendation: "x".repeat(20), confidence: "low" } },
              ],
              [{ tool: "finish", input: { summary: "AI pass done." } }],
            ]
    ]);
    await investigate(ws, audit.id, { provider, batches: ["ai"] });
    const after = ws.getAudit(audit.id);
    const added = after.findings.find((f) => f.source === "agent");
    expect(added?.title).toMatch(/fully automated/);
    expect(added?.controlIds).toEqual([control.id]);
    expect(provider.results.some((r) => r.isError && /Unknown or out-of-batch/.test(r.content))).toBe(true);
    expect(after.phase).toBe("review");
  });
});

describe("resilience to model and network failures", () => {
  const repo = exampleRepo("telehealth-api");
  afterAll(() => repo.cleanup());
  const flaky = (failOn: (run: number) => boolean, inner: ScriptedProvider) => {
    let n = 0;
    return Object.assign(Object.create(inner), {
      run: async (r: Parameters<ScriptedProvider["run"]>[0]) => {
        if (failOn(n++)) throw new Error("Connection error.");
        return inner.run(r);
      },
    }) as ScriptedProvider;
  };

  it("an interrupted fix restores the files and marks the finding fix_failed instead of leaving it stuck", async () => {
    const ws = Workspace.open(repo.dir);
    ws.applyPreset("telehealth-platform-eu", alice);
    ws.confirmAnswers("all", alice);
    const audit = ws.createAudit({ mode: "static", actor: alice });
    const f = audit.findings.find((x) => x.checkId === "tls-verification-disabled")!;
    await ws.review(audit.id, f.id, { action: "confirm" }, alice);
    ws.setVerify(["npm test"], { approve: true }, alice);
    // The provider edits a file and then the connection drops mid-run.
    const editing = new ScriptedProvider([[[{ tool: "edit_file", input: { path: "src/server.js", old_string: "process.env.NODE_TLS_REJECT_UNAUTHORIZED", new_string: "process.env.X" } }]]]);
    const provider = Object.assign(Object.create(editing), {
      run: async (r: Parameters<ScriptedProvider["run"]>[0]) => {
        await editing.run(r);
        throw new Error("Connection error.");
      },
    }) as ScriptedProvider;
    await expect(fixFinding(ws, audit.id, f.id, { provider })).rejects.toThrow(/Connection error/);
    const after = ws.getAudit(audit.id).findings.find((x) => x.id === f.id)!;
    expect(after.status).toBe("fix_failed");
    expect(after.fix?.error).toMatch(/interrupted: Connection error/);
    expect(readFileSync(join(repo.dir, "src/server.js"), "utf8")).toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(repo.git("status", "--porcelain", "--", "src").trim()).toBe("");
  });

  it("a failing investigation batch is recorded while the other batches still run", async () => {
    const ws = Workspace.open(repo.dir);
    const audit = ws.createAudit({ mode: "agent", actor: alice });
    const finish = [[{ tool: "finish", input: { summary: "checked" } }]];
    const provider = flaky((n) => n === 0, new ScriptedProvider(Array.from({ length: 8 }, () => finish)));
    await investigate(ws, audit.id, { provider, parallel: 1 });
    const a = ws.getAudit(audit.id);
    expect(a.phase).toBe("review");
    expect(a.error).toMatch(/1 of \d+ investigation batches failed/);
    expect(a.notes.filter((n) => n.text.includes("checked")).length).toBeGreaterThan(2);
    const allFail = flaky(() => true, new ScriptedProvider([]));
    await expect(investigate(ws, audit.id, { provider: allFail })).rejects.toThrow(/Every investigation batch failed/);
  });
});

describe("one issue, one finding", () => {
  const repo = exampleRepo("telehealth-api");
  afterAll(() => repo.cleanup());
  it("merges an agent finding into a detector finding at the same place instead of duplicating it", () => {
    const ws = Workspace.open(repo.dir);
    const audit = ws.createAudit({ mode: "static", actor: alice });
    const leak = audit.findings.find((f) => f.checkId === "error-details-leak")!;
    const [merged] = ws.addFindings(
      audit.id,
      [{ title: "Error handler returns stack traces to clients", description: "The catch-all handler sends err.stack.", severity: "medium", category: leak.category, locations: [{ path: leak.locations[0].path, line: leak.locations[0].line! + 1 }], evidence: "Read the handler.", recommendation: "Return a generic error." }],
      agent,
    );
    expect(merged.id).toBe(leak.id);
    expect(ws.getAudit(audit.id).findings.length).toBe(audit.findings.length);
    expect(merged.history.at(-1)?.note).toMatch(/Also found by/);
    const [separate] = ws.addFindings(
      audit.id,
      [{ title: "Unrelated issue elsewhere", description: "Different file.", severity: "low", category: "governance", locations: [{ path: "README.md", line: 1 }], evidence: "Read README.", recommendation: "Document it." }],
      agent,
    );
    expect(separate.id).not.toBe(leak.id);
  });
});
