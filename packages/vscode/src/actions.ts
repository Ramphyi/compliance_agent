import * as vscode from "vscode";
import type { AcaiClient, AuditDetail, Finding, Job, JobEvent, RejectReason, ReviewAction } from "./api";
import { can, FindingNode, loc, locationPath, STATUS_LABEL } from "./findings";
import type { AcaiState } from "./state";

export type ActionContext = {
  state: AcaiState;
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  openDashboard(findingId?: string): Promise<void>;
  revealFindings(): void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Show the API's {error} message, with a shortcut when the cause is a missing model. */
export async function showError(e: unknown, prefix = "Acai") {
  const message = (e as Error)?.message ?? String(e);
  const noModel = /no model provider/i.test(message);
  const choice = await vscode.window.showErrorMessage(`${prefix}: ${message}`, ...(noModel ? ["Set API Key", "Ask Copilot"] : ["Show Output"]));
  if (choice === "Set API Key") void vscode.commands.executeCommand("acai.setApiKey");
  else if (choice === "Ask Copilot") void askCopilot();
  else if (choice === "Show Output") void vscode.commands.executeCommand("workbench.action.output.show.extension-output-acai-internal.acai-vscode-#1-Acai");
}

/** Open Copilot Chat in agent mode with a prompt that uses the Acai MCP tools. */
export async function askCopilot(prompt = "Audit this project for compliance using the Acai MCP tools. Ask me to decide on each finding.") {
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", { query: prompt, mode: "agent" });
  } catch {
    void vscode.window.showInformationMessage(`Open Copilot Chat in agent mode, enable the Acai tools, and ask: "${prompt}"`);
  }
}

function connection(ctx: ActionContext): { client: AcaiClient; pid: string } | undefined {
  const { client, projectId } = ctx.state;
  if (client && projectId) return { client, pid: projectId };
  void vscode.window.showWarningMessage(ctx.state.folder ? "The Acai server is not running." : "Open a folder to use Acai.", ...(ctx.state.folder ? ["Restart Server"] : [])).then((c) => {
    if (c) void vscode.commands.executeCommand("acai.restartServer");
  });
  return undefined;
}

function latestAudit(ctx: ActionContext): AuditDetail | undefined {
  const a = ctx.state.audit;
  if (!a) {
    void vscode.window.showInformationMessage("No Acai audit yet for this folder.", "Run Audit").then((c) => {
      if (c) void vscode.commands.executeCommand("acai.runAudit");
    });
  }
  return a;
}

/** A command argument from the tree (FindingNode), a code action or command URI (id string), or nothing. */
export function findingIdFrom(arg: unknown): string | undefined {
  if (arg instanceof FindingNode) return arg.finding.id;
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const o = arg as { findingId?: unknown; id?: unknown; finding?: { id?: unknown } };
    if (typeof o.findingId === "string") return o.findingId;
    if (typeof o.finding?.id === "string") return o.finding.id;
    if (typeof o.id === "string" && /^F-/.test(o.id)) return o.id;
  }
  return undefined;
}

/** Find the finding an action targets, asking with a QuickPick when the command came from the palette. */
async function targetFinding(ctx: ActionContext, arg: unknown, action: ReviewAction | undefined, verb: string): Promise<Finding | undefined> {
  const a = latestAudit(ctx);
  if (!a) return undefined;
  const id = findingIdFrom(arg);
  if (id) {
    let f = ctx.state.findingById(id);
    if (!f) {
      await ctx.state.refresh();
      f = ctx.state.findingById(id);
    }
    if (!f) {
      void vscode.window.showWarningMessage(`Finding ${id} is not in the latest audit.`);
      return undefined;
    }
    if (action && !can(f, action)) {
      void vscode.window.showWarningMessage(`Cannot ${verb} ${f.id}: it is ${STATUS_LABEL[f.status]}.`);
      return undefined;
    }
    return f;
  }
  const candidates = ctx.state.findings.filter((f) => !action || can(f, action));
  if (!candidates.length) {
    void vscode.window.showInformationMessage(`No findings to ${verb}.`);
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    candidates.map((f) => ({ label: `${f.id} ${f.title}`, description: `${f.severity}${f.locations[0] ? ` · ${loc(f.locations[0])}` : ""}`, detail: STATUS_LABEL[f.status], f })),
    { placeHolder: `Finding to ${verb}`, matchOnDescription: true },
  );
  return pick?.f;
}

async function review(ctx: ActionContext, f: Finding, body: { action: ReviewAction; note?: string; reason?: RejectReason }) {
  const c = connection(ctx);
  const audit = ctx.state.audit;
  if (!c || !audit) return undefined;
  try {
    const out = await c.client.post<{ finding: Finding; jobId?: string }>(
      `/api/projects/${c.pid}/audits/${encodeURIComponent(audit.id)}/findings/${encodeURIComponent(f.id)}/review`,
      body,
    );
    void ctx.state.refresh();
    return out;
  } catch (e) {
    void showError(e);
    return undefined;
  }
}

// ------------------------------------------------------------------ review actions

export async function confirmFinding(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, "confirm", "confirm");
  if (!f) return;
  if (await review(ctx, f, { action: "confirm" })) vscode.window.setStatusBarMessage(`$(check) Acai: confirmed ${f.id}`, 4000);
}

const REJECT_REASONS: { label: string; reason: RejectReason; detail: string }[] = [
  { label: "False positive", reason: "false-positive", detail: "The issue is not present in the code." },
  { label: "Accepted risk", reason: "accepted-risk", detail: "The issue is real; the risk is accepted (say who accepted it and why)." },
  { label: "Not applicable", reason: "not-applicable", detail: "The requirement does not apply to this product." },
  { label: "Duplicate", reason: "duplicate", detail: "Another finding covers the same issue." },
  { label: "Other", reason: "other", detail: "Explain in the note." },
];

export async function rejectFinding(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, "reject", "reject");
  if (!f) return;
  const pick = await vscode.window.showQuickPick(REJECT_REASONS, { title: `Reject ${f.id}: ${f.title}`, placeHolder: "Why is this finding rejected?" });
  if (!pick) return;
  const needsNote = pick.reason === "other" || pick.reason === "accepted-risk";
  const note = await vscode.window.showInputBox({
    title: `Reject ${f.id} (${pick.label.toLowerCase()})`,
    prompt: needsNote ? "Note for the audit trail (required)" : "Note for the audit trail (optional)",
    placeHolder: pick.reason === "accepted-risk" ? "Accepted by … because …" : "",
    ignoreFocusOut: true,
    validateInput: (v) => (needsNote && !v.trim() ? "A note is required for this reason." : undefined),
  });
  if (note === undefined) return;
  if (await review(ctx, f, { action: "reject", reason: pick.reason, note: note.trim() || undefined }))
    vscode.window.setStatusBarMessage(`$(close) Acai: rejected ${f.id} (${pick.label.toLowerCase()})`, 4000);
}

export async function reinvestigateFinding(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, "reinvestigate", "re-investigate");
  if (!f) return;
  const note = await vscode.window.showInputBox({
    title: `Re-investigate ${f.id}: ${f.title}`,
    prompt: "What should the agent look at again? (required)",
    placeHolder: "For example: input is validated in middleware/auth.ts before this handler runs",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "Tell the agent what to look at."),
  });
  if (note === undefined) return;
  const out = await review(ctx, f, { action: "reinvestigate", note: note.trim() });
  if (!out) return;
  if (out.jobId) return void trackJob(ctx, out.jobId, `Re-investigating ${f.id}`);
  const running = ctx.state.project?.running;
  const message = !ctx.state.meta?.provider
    ? `${f.id} is marked for re-investigation. No model is configured for the Acai server: ask Copilot Chat in agent mode to re-investigate it with the Acai tools, or set an API key.`
    : `${f.id} is marked for re-investigation.${running ? ` Another job is running (${running}); start the re-investigation from the dashboard when it finishes.` : ""}`;
  const choice = await vscode.window.showInformationMessage(message, ...(!ctx.state.meta?.provider ? ["Ask Copilot", "Set API Key"] : ["Open Dashboard"]));
  if (choice === "Ask Copilot") void askCopilot(`Re-investigate Acai finding ${f.id} using the Acai MCP tools. My note: ${note.trim()}`);
  else if (choice === "Set API Key") void vscode.commands.executeCommand("acai.setApiKey");
  else if (choice === "Open Dashboard") void ctx.openDashboard(f.id);
}

export async function acceptFix(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, "accept-fix", "accept the fix of");
  if (!f) return;
  if (await review(ctx, f, { action: "accept-fix" })) vscode.window.setStatusBarMessage(`$(pass) Acai: accepted the fix for ${f.id}`, 4000);
}

export async function revertFix(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, "revert-fix", "revert the fix of");
  if (!f) return;
  const ok = await vscode.window.showWarningMessage(
    `Revert the fix for ${f.id}?`,
    { modal: true, detail: `${f.fix?.commit ? `Commit ${f.fix.commit.slice(0, 8)} will be reverted in your repository. ` : ""}The finding goes back to confirmed.` },
    "Revert Fix",
  );
  if (ok !== "Revert Fix") return;
  if (await review(ctx, f, { action: "revert-fix" })) vscode.window.setStatusBarMessage(`$(discard) Acai: reverted the fix for ${f.id}`, 4000);
}

export async function modifyFinding(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, undefined, "modify");
  if (f) await ctx.openDashboard(f.id);
}

export async function openFindingLocation(ctx: ActionContext, arg: unknown) {
  const f = await targetFinding(ctx, arg, undefined, "open");
  if (!f || !ctx.state.folder) return;
  const folder = ctx.state.folder;
  const ref = f.locations.find((l) => locationPath(folder, l));
  if (!ref) {
    await ctx.openDashboard(f.id);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(locationPath(folder, ref)!));
  const line = Math.min(Math.max(0, (ref.line ?? 1) - 1), Math.max(0, doc.lineCount - 1));
  const end = Math.min(Math.max(line, (ref.endLine ?? ref.line ?? 1) - 1), Math.max(0, doc.lineCount - 1));
  const range = new vscode.Range(line, 0, end, doc.lineAt(end).text.length);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(range.start, range.start), preview: true });
  const editor = vscode.window.activeTextEditor;
  if (editor?.document === doc) editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

// ------------------------------------------------------------------ audits and jobs

export async function runAudit(ctx: ActionContext) {
  const c = connection(ctx);
  if (!c) return;
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Acai: running detectors…" },
    async () => {
      try {
        return await c.client.post<{ audit: AuditDetail }>(`/api/projects/${c.pid}/audits`, { mode: "static" }, 15 * 60_000);
      } catch (e) {
        void showError(e);
        return undefined;
      }
    },
  );
  if (!result) return;
  await ctx.state.refresh();
  const s = ctx.state.audit?.summary;
  const choice = await vscode.window.showInformationMessage(
    `Acai audit ${result.audit.id}: ${s?.total ?? result.audit.findings.length} findings${s ? `, ${s.open} to decide` : ""}.`,
    "Show Findings",
    "Open Dashboard",
  );
  if (choice === "Show Findings") ctx.revealFindings();
  else if (choice === "Open Dashboard") void ctx.openDashboard();
}

/** Agent features send code excerpts to the model provider: ask once per destination. */
async function consentToProvider(ctx: ActionContext): Promise<boolean> {
  await ctx.state.refresh();
  const p = ctx.state.meta?.provider;
  if (!p) {
    const choice = await vscode.window.showWarningMessage(
      "Agent audits need a model. Set an Anthropic API key (or configure an OpenAI-compatible endpoint in settings), or let Copilot Chat drive the audit through the Acai MCP server.",
      "Set API Key",
      "Ask Copilot",
      "Open Settings",
    );
    if (choice === "Set API Key") void vscode.commands.executeCommand("acai.setApiKey");
    else if (choice === "Ask Copilot") void askCopilot();
    else if (choice === "Open Settings") void vscode.commands.executeCommand("workbench.action.openSettings", "acai.");
    return false;
  }
  const key = `acai.consent:${p.destination}`;
  if (ctx.context.globalState.get<boolean>(key)) return true;
  const ok = await vscode.window.showInformationMessage(
    "Send code excerpts to the model provider?",
    { modal: true, detail: `Agent audits, re-investigations and fixes send excerpts of this project's code to: ${p.destination} (model ${p.model}). Detector audits stay on this machine.` },
    "Continue",
  );
  if (ok !== "Continue") return false;
  await ctx.context.globalState.update(key, true);
  return true;
}

export async function runAgentAudit(ctx: ActionContext) {
  const c = connection(ctx);
  if (!c || !(await consentToProvider(ctx))) return;
  try {
    const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Acai: scanning before the agent audit…" }, () =>
      c.client.post<{ audit: AuditDetail; jobId?: string }>(`/api/projects/${c.pid}/audits`, { mode: "agent" }, 15 * 60_000),
    );
    void ctx.state.refresh();
    if (out.jobId) void trackJob(ctx, out.jobId, `Agent audit ${out.audit.id}`);
  } catch (e) {
    void showError(e);
  }
}

export async function fixConfirmed(ctx: ActionContext) {
  const c = connection(ctx);
  const a = latestAudit(ctx);
  if (!c || !a) return;
  const ids = a.findings.filter((f) => f.status === "confirmed" && f.fixability !== "process").map((f) => f.id);
  if (!ids.length) {
    void vscode.window.showInformationMessage("No confirmed findings to fix. Confirm findings first (process findings are fixed outside the code).");
    return;
  }
  if (!(await consentToProvider(ctx))) return;
  const ok = await vscode.window.showWarningMessage(
    `Fix ${ids.length} confirmed finding(s)?`,
    {
      modal: true,
      detail: `${ids.join(", ")}\n\nAcai edits files in this working tree and runs the approved build and test commands. Every fix waits for your review (Accept Fix or Revert Fix).`,
    },
    "Fix",
  );
  if (ok !== "Fix") return;
  try {
    const job = await c.client.post<Job>(`/api/projects/${c.pid}/audits/${encodeURIComponent(a.id)}/fix-confirmed`, {});
    void ctx.state.refresh();
    void trackJob(ctx, job.id, `Fixing ${ids.length} finding(s)`);
  } catch (e) {
    void showError(e);
  }
}

function describe(e: JobEvent | undefined) {
  if (!e) return undefined;
  if (e.type === "notice") return e.message;
  if (e.type === "tool") return e.name ? `tool ${e.name}` : undefined;
  if (e.type === "search") return e.query ? `searching: ${e.query}` : "searching the web";
  if (e.type === "text") return e.text ? e.text.replace(/\s+/g, " ").slice(0, 100) : undefined;
  if (e.type === "turn") return "thinking…";
  return undefined;
}

/** Progress notification that polls GET /api/jobs/:id until the job is no longer running. */
export async function trackJob(ctx: ActionContext, jobId: string, title: string) {
  const c = ctx.state.client;
  if (!c) return;
  const job = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Acai: ${title}`, cancellable: true },
    async (progress, token) => {
      token.onCancellationRequested(() => {
        c.post(`/api/jobs/${encodeURIComponent(jobId)}/cancel`).catch(() => undefined);
      });
      let last = "";
      for (;;) {
        let j: Job;
        try {
          j = await c.get<Job>(`/api/jobs/${encodeURIComponent(jobId)}`);
        } catch (e) {
          void showError(e, `Acai: lost track of "${title}"`);
          return undefined;
        }
        if (j.status !== "running") return j;
        const msg = describe(j.events?.filter((e) => e.type !== "status").at(-1));
        if (msg && msg !== last) {
          last = msg;
          progress.report({ message: msg });
        }
        await sleep(1500);
      }
    },
  );
  await ctx.state.refresh();
  if (!job) return;
  if (job.status === "failed") return void showError(new Error(job.error ?? "the job failed"), `Acai: ${title} failed`);
  if (job.status === "cancelled") return void vscode.window.showInformationMessage(`Acai: ${title} was cancelled.`);
  const s = ctx.state.audit?.summary;
  const detail = s ? ` ${s.open} to decide, ${s.fixReady} fix(es) to review.` : "";
  const choice = await vscode.window.showInformationMessage(`Acai: ${title} finished.${detail}`, "Show Findings", "Open Dashboard");
  if (choice === "Show Findings") ctx.revealFindings();
  else if (choice === "Open Dashboard") void ctx.openDashboard(job.findingId);
}

export async function showReport(ctx: ActionContext) {
  const c = connection(ctx);
  const a = latestAudit(ctx);
  if (!c || !a) return;
  try {
    const md = await c.client.getText(`/api/projects/${c.pid}/audits/${encodeURIComponent(a.id)}/report?format=md`);
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand("markdown.showPreviewToSide").then(undefined, () => undefined);
  } catch (e) {
    void showError(e);
  }
}
