import { existsSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { CodeRef, Finding, FindingStatus, ReviewAction, Severity } from "./api";
import { settings } from "./config";
import type { AssayState } from "./state";

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Which statuses each review action may start from (mirrors packages/core/src/review.ts). */
export const ALLOWED_FROM: Record<ReviewAction, FindingStatus[]> = {
  confirm: ["open", "withdrawn", "fix_failed", "reinvestigating"],
  reject: ["open", "confirmed", "withdrawn", "fix_failed", "reinvestigating"],
  modify: ["open", "confirmed", "withdrawn", "fix_failed"],
  reinvestigate: ["open", "confirmed", "withdrawn", "fix_failed", "rejected"],
  reopen: ["rejected", "withdrawn", "resolved", "fix_failed"],
  "accept-fix": ["fix_ready"],
  "revert-fix": ["fix_ready"],
  resolve: ["open", "confirmed", "fix_failed"],
};

export const can = (f: Finding, action: ReviewAction) => (f.actions ? f.actions.includes(action) : ALLOWED_FROM[action].includes(f.status));

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "open",
  confirmed: "confirmed",
  rejected: "rejected",
  reinvestigating: "re-investigating",
  withdrawn: "withdrawn",
  fixing: "fixing",
  fix_ready: "fix ready",
  fix_failed: "fix failed",
  resolved: "resolved",
};

/** Statuses that no longer need attention: hidden from the Problems panel. */
const SETTLED = new Set<FindingStatus>(["rejected", "withdrawn", "resolved"]);

const GROUPS: { id: string; label: string; statuses: FindingStatus[]; collapsed?: boolean }[] = [
  { id: "decide", label: "Needs decision", statuses: ["open", "reinvestigating"] },
  { id: "confirmed", label: "Confirmed", statuses: ["confirmed", "fixing"] },
  { id: "fix_ready", label: "Fixes to review", statuses: ["fix_ready"] },
  { id: "fix_failed", label: "Fix failed", statuses: ["fix_failed"] },
  { id: "done", label: "Done", statuses: ["resolved", "rejected", "withdrawn"], collapsed: true },
];

export const loc = (r?: CodeRef) => (r ? `${r.path}${r.line ? `:${r.line}` : ""}` : "");

export function severityIcon(s: Severity) {
  switch (s) {
    case "critical":
      return new vscode.ThemeIcon("flame", new vscode.ThemeColor("problemsErrorIcon.foreground"));
    case "high":
      return new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"));
    case "medium":
      return new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground"));
    case "low":
      return new vscode.ThemeIcon("info", new vscode.ThemeColor("problemsInfoIcon.foreground"));
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

/** Finding text comes from detectors and models: render it as markdown, but never load remote images. */
const safeMd = (s: string) => (s ?? "").replace(/!\[/g, "!\\[");

export function findingTooltip(f: Finding) {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${f.id}** · $(${severityIcon(f.severity).id}) ${f.severity} · ${STATUS_LABEL[f.status]} · ${f.category}\n\n`);
  md.appendMarkdown(`**${safeMd(f.title)}**\n\n`);
  if (f.description) md.appendMarkdown(`${safeMd(f.description)}\n\n`);
  if (f.recommendation) md.appendMarkdown(`**Recommendation:** ${safeMd(f.recommendation)}\n\n`);
  if (f.fix?.summary) md.appendMarkdown(`**Fix:** ${safeMd(f.fix.summary)}\n\n`);
  if (f.reinvestigateNote && f.status === "reinvestigating") md.appendMarkdown(`**Re-investigate:** ${safeMd(f.reinvestigateNote)}\n\n`);
  if (f.controls?.length) md.appendMarkdown(`**Controls:** ${f.controls.slice(0, 6).map((c) => `${c.framework} ${c.ref}`).join("; ")}\n\n`);
  if (f.locations.length) md.appendMarkdown(`**Where:** ${f.locations.slice(0, 6).map((l) => `\`${loc(l)}\``).join(", ")}`);
  return md;
}

// ------------------------------------------------------------------ findings tree

export class GroupNode {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly findings: Finding[],
    readonly collapsed: boolean,
  ) {}
}

export class FindingNode {
  constructor(readonly finding: Finding) {}
}

type Node = GroupNode | FindingNode;

export class FindingsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly state: AssayState) {}

  refresh() {
    this.emitter.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (node instanceof FindingNode) return [];
    if (node instanceof GroupNode) return node.findings.map((f) => new FindingNode(f));
    const findings = this.state.findings;
    return GROUPS.map((g) => {
      const items = findings
        .filter((f) => g.statuses.includes(f.status))
        .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id, undefined, { numeric: true }));
      return new GroupNode(g.id, g.label, items, Boolean(g.collapsed));
    }).filter((g) => g.findings.length);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node instanceof GroupNode) {
      const item = new vscode.TreeItem(node.label, node.collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${node.id}`;
      item.description = String(node.findings.length);
      item.contextValue = `group.${node.id}`;
      return item;
    }
    const f = node.finding;
    const item = new vscode.TreeItem(`${f.id} ${f.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = `finding:${f.id}`;
    const where = loc(f.locations[0]);
    const extra = f.status === "open" || f.status === "confirmed" || f.status === "fix_ready" || f.status === "fix_failed" ? "" : ` · ${STATUS_LABEL[f.status]}`;
    item.description = `${f.severity}${where ? ` · ${where}` : ""}${extra}`;
    item.iconPath = f.status === "fixing" ? new vscode.ThemeIcon("sync~spin") : severityIcon(f.severity);
    item.tooltip = findingTooltip(f);
    item.contextValue = `finding.${f.status}`;
    item.command = { command: "assay.openFindingLocation", title: "Go to Finding Location", arguments: [f.id] };
    return item;
  }

  getParent(node: Node): Node | undefined {
    if (node instanceof GroupNode) return undefined;
    return this.getChildren().find((g) => g instanceof GroupNode && g.findings.some((f) => f.id === node.finding.id));
  }
}

// ------------------------------------------------------------------ overview tree

export type StatusNode = {
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  command?: vscode.Command;
  children?: StatusNode[];
};

export class StatusTreeProvider implements vscode.TreeDataProvider<StatusNode> {
  private readonly emitter = new vscode.EventEmitter<StatusNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly state: AssayState,
    private readonly serverInfo: () => { state: string; url?: string; error?: string },
  ) {}

  refresh() {
    this.emitter.fire(undefined);
  }

  getTreeItem(n: StatusNode): vscode.TreeItem {
    const item = new vscode.TreeItem(n.label, n.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `status:${n.key}`;
    item.description = n.description;
    item.tooltip = n.tooltip;
    if (n.icon) item.iconPath = new vscode.ThemeIcon(n.icon);
    item.command = n.command;
    return item;
  }

  getChildren(n?: StatusNode): StatusNode[] {
    if (n) return n.children ?? [];
    const s = this.state;
    const server = this.serverInfo();
    const nodes: StatusNode[] = [];
    if (!s.folder) return [{ key: "nofolder", label: "No folder open", icon: "folder" }];
    nodes.push({
      key: "project",
      label: s.project?.name ?? path.basename(s.folder),
      description: s.project?.classification ? truncate(s.project.classification, 60) : undefined,
      tooltip: `${s.folder}${s.project?.classification ? `\n${s.project.classification}` : ""}`,
      icon: "repo",
      command: { command: "assay.openDashboard", title: "Open Dashboard" },
    });
    nodes.push({
      key: "server",
      label: "Server",
      description: server.state === "running" ? server.url : server.state,
      tooltip: server.error ?? server.url,
      icon: server.state === "running" ? "server-process" : server.state === "starting" ? "loading~spin" : "debug-disconnect",
      command: server.state === "error" ? { command: "assay.restartServer", title: "Restart Server" } : undefined,
    });
    if (s.project?.running) nodes.push({ key: "job", label: "Running", description: s.project.running, icon: "sync~spin" });
    const p = s.meta?.provider;
    nodes.push({
      key: "model",
      label: "Model",
      description: p ? `${p.model} (${p.id})` : s.meta ? "none (detectors only)" : "…",
      tooltip: p ? `Agent features send code excerpts to: ${p.destination}` : "No model configured. Detectors run locally; Copilot agent mode can reason through the Assay MCP server, or set an API key.",
      icon: "hubot",
      command: p ? undefined : { command: "assay.setApiKey", title: "Set Anthropic API Key" },
    });
    if (s.scope) {
      const active = s.scope.filter((x) => x.active);
      const unknown = s.scope.filter((x) => x.status === "unknown").length;
      nodes.push({
        key: "scope",
        label: "Frameworks in scope",
        description: `${active.length}${unknown ? ` (+${unknown} undecided)` : ""}`,
        icon: "law",
        children: active.map((x) => ({ key: `scope:${x.frameworkId}`, label: x.shortTitle, tooltip: x.title, icon: "book" })),
      });
    } else if (s.meta?.registry) {
      nodes.push({ key: "registry", label: "Registry", description: `${s.meta.registry.frameworks} frameworks, ${s.meta.registry.controls} controls`, icon: "law" });
    }
    const a = s.audit;
    if (a) {
      const m = a.summary;
      const sev = (Object.keys(SEVERITY_RANK) as Severity[]).filter((k) => m.bySeverity[k]).map((k) => `${m.bySeverity[k]} ${k}`).join(", ");
      nodes.push({
        key: "audit",
        label: "Latest audit",
        description: `${m.total} findings · ${a.phase}`,
        tooltip: `${a.id}\n${a.mode} audit, ${new Date(a.createdAt).toLocaleString()}${a.model ? `\nModel ${a.model}` : ""}${a.error ? `\nError: ${a.error}` : ""}`,
        icon: "checklist",
        children: [
          { key: "a:id", label: a.id, description: `${a.mode} · ${new Date(a.createdAt).toLocaleString()}`, icon: "history", command: { command: "assay.showReport", title: "Show Report" } },
          { key: "a:decide", label: "Needs decision", description: String(m.open + m.reinvestigating), icon: "question" },
          { key: "a:confirmed", label: "Confirmed", description: String(m.confirmed + m.fixing), icon: "check" },
          { key: "a:fixready", label: "Fixes to review", description: String(m.fixReady), icon: "git-pull-request" },
          { key: "a:fixfailed", label: "Fix failed", description: String(m.fixFailed), icon: "error" },
          { key: "a:done", label: "Done", description: `${m.resolved} resolved, ${m.rejected} rejected, ${m.withdrawn} withdrawn`, icon: "pass" },
          { key: "a:sev", label: "Unresolved by severity", description: sev || "none", icon: "graph" },
        ],
      });
    } else if (server.state === "running" && s.projectId) {
      nodes.push({ key: "noaudit", label: "No audit yet", icon: "circle-large-outline", command: { command: "assay.runAudit", title: "Run Audit" } });
    }
    if (s.loadError) nodes.push({ key: "error", label: "Error", description: s.loadError, tooltip: s.loadError, icon: "warning" });
    return nodes;
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ------------------------------------------------------------------ diagnostics

const DIAG_SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  critical: vscode.DiagnosticSeverity.Error,
  high: vscode.DiagnosticSeverity.Error,
  medium: vscode.DiagnosticSeverity.Warning,
  low: vscode.DiagnosticSeverity.Information,
  info: vscode.DiagnosticSeverity.Information,
};

export const dashboardCommandUri = (findingId: string) =>
  vscode.Uri.parse(`command:assay.openDashboard?${encodeURIComponent(JSON.stringify([findingId]))}`);

/** Absolute path of a finding location, or undefined if it escapes the folder or does not exist. */
export function locationPath(folder: string, ref: CodeRef): string | undefined {
  const abs = path.resolve(folder, ref.path);
  if (abs !== folder && !abs.startsWith(folder + path.sep)) return undefined;
  return existsSync(abs) ? abs : undefined;
}

const lineRange = (ref: CodeRef) => {
  const line = Math.max(0, (ref.line ?? 1) - 1);
  return new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
};

export class FindingDiagnostics implements vscode.Disposable {
  readonly collection = vscode.languages.createDiagnosticCollection("assay");

  constructor(private readonly state: AssayState) {}

  update() {
    this.collection.clear();
    const folder = this.state.folder;
    if (!folder || !settings().diagnostics) return;
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const f of this.state.findings) {
      if (SETTLED.has(f.status)) continue;
      const places = f.locations
        .slice(0, 50)
        .map((ref) => ({ ref, abs: locationPath(folder, ref) }))
        .filter((x): x is { ref: CodeRef; abs: string } => Boolean(x.abs));
      for (const { ref, abs } of places) {
        const d = new vscode.Diagnostic(lineRange(ref), `${f.title} (${f.id}, ${STATUS_LABEL[f.status]})`, DIAG_SEVERITY[f.severity] ?? vscode.DiagnosticSeverity.Information);
        d.source = "Assay";
        d.code = { value: f.id, target: dashboardCommandUri(f.id) };
        const others = places.filter((p) => p.ref !== ref).slice(0, 5);
        if (others.length)
          d.relatedInformation = others.map(
            (o) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(o.abs), lineRange(o.ref)), `${f.id} also here`),
          );
        const list = byFile.get(abs) ?? [];
        list.push(d);
        byFile.set(abs, list);
      }
    }
    for (const [file, list] of byFile) this.collection.set(vscode.Uri.file(file), list);
  }

  dispose() {
    this.collection.dispose();
  }
}

export const findingIdOf = (d: vscode.Diagnostic): string | undefined => {
  if (d.source !== "Assay" || d.code === undefined) return undefined;
  return typeof d.code === "object" ? String(d.code.value) : String(d.code);
};

export class FindingCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly state: AssayState) {}

  provideCodeActions(_doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const out: vscode.CodeAction[] = [];
    const seen = new Set<string>();
    for (const d of ctx.diagnostics) {
      const id = findingIdOf(d);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const f = this.state.findingById(id);
      const add = (title: string, command: string) => {
        const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        a.command = { command, title, arguments: [id] };
        a.diagnostics = [d];
        out.push(a);
      };
      if (f && can(f, "confirm")) add(`Assay: Confirm ${id}`, "assay.confirmFinding");
      if (f && can(f, "reject")) add(`Assay: Reject ${id}…`, "assay.rejectFinding");
      add("Assay: Open in dashboard", "assay.openDashboard");
    }
    return out;
  }
}
