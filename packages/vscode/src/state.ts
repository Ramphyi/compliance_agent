import * as path from "node:path";
import * as vscode from "vscode";
import { type AuditDetail, type AuditListItem, AssayClient, EventStream, type Finding, type Meta, type ProjectEntry, type ScopeItem } from "./api";
import { resolveStateDir, reviewerName, samePath } from "./config";
import type { ServerManager } from "./server";

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;

/**
 * What the extension knows about the current folder's Assay project: the latest audit and its
 * findings, the model, the scope. Kept current from the server's event stream and the file system.
 */
export class AssayState implements vscode.Disposable {
  folder?: string;
  client?: AssayClient;
  projectId?: string;
  project?: ProjectEntry;
  meta?: Meta;
  audit?: AuditDetail;
  scope?: ScopeItem[];
  loadError?: string;

  private events?: EventStream;
  private watcher?: vscode.FileSystemWatcher;
  private timer?: NodeJS.Timeout;
  private firstScheduled = 0;
  private refreshing?: Promise<void>;
  private again = false;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly jobEmitter = new vscode.EventEmitter<{ jobId: string; projectId: string; event: { type: string; status?: string } }>();
  readonly onJobEvent = this.jobEmitter.event;

  constructor(
    private readonly server: ServerManager,
    private readonly output: vscode.OutputChannel,
  ) {}

  get findings(): Finding[] {
    return this.audit?.findings ?? [];
  }

  /** Called when the server becomes ready (or stops). */
  async connect(folder: string | undefined) {
    this.disconnect();
    this.folder = folder;
    const url = this.server.url;
    if (!folder || !url) {
      this.changeEmitter.fire();
      return;
    }
    const client = new AssayClient(url, reviewerName);
    this.client = client;
    try {
      const projects = await client.get<ProjectEntry[]>("/api/projects");
      let entry = projects.find((p) => samePath(p.root, folder));
      if (!entry) entry = await client.post<ProjectEntry>("/api/projects", { path: folder });
      if (this.client !== client) return; // superseded by another connect
      this.projectId = entry.id;
      this.project = entry;
    } catch (e) {
      this.loadError = (e as Error).message;
      this.output.appendLine(`[assay] could not find the project for ${folder}: ${this.loadError}`);
      this.changeEmitter.fire();
      return;
    }
    const pid = this.projectId;
    this.events = new EventStream(
      `${url}/api/events?project=${encodeURIComponent(pid)}`,
      (type, data) => {
        if (type === "job") this.jobEmitter.fire(data as never);
        if (type === "change" || type === "job" || type === "hello") this.scheduleRefresh();
      },
      (line) => this.output.appendLine(`[assay] ${line}`),
    );
    this.watchStateDir(folder);
    await this.refresh();
  }

  disconnect() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.events?.dispose();
    this.events = undefined;
    this.watcher?.dispose();
    this.watcher = undefined;
    this.client = undefined;
    this.projectId = undefined;
    this.project = undefined;
    this.meta = undefined;
    this.audit = undefined;
    this.scope = undefined;
    this.loadError = undefined;
  }

  /** Changes written by another process (the MCP server Copilot runs, the CLI) arrive through the file system. */
  private watchStateDir(folder: string) {
    const custom = resolveStateDir(folder);
    const pattern =
      custom && !custom.startsWith(folder + path.sep)
        ? new vscode.RelativePattern(vscode.Uri.file(custom), "**/*.json")
        : new vscode.RelativePattern(vscode.Uri.file(folder), `${custom ? path.relative(folder, custom).split(path.sep).join("/") : ".assay"}/**/*.json`);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const kick = () => this.scheduleRefresh();
    this.watcher.onDidChange(kick);
    this.watcher.onDidCreate(kick);
    this.watcher.onDidDelete(kick);
  }

  /** Debounced refresh: waits for a 400 ms lull, but never longer than 2 s while events keep coming. */
  scheduleRefresh() {
    const now = Date.now();
    if (!this.timer) this.firstScheduled = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstScheduled + MAX_WAIT_MS - now));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, wait);
  }

  /** Reload meta, project, latest audit and scope. Concurrent calls coalesce. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        await this.load();
      } while (this.again);
    })().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async load() {
    const client = this.client;
    const pid = this.projectId;
    if (!client || !pid) return;
    try {
      const [meta, projects, audits] = await Promise.all([
        client.get<Meta>("/api/meta"),
        client.get<ProjectEntry[]>("/api/projects"),
        client.get<AuditListItem[]>(`/api/projects/${pid}/audits`),
      ]);
      const audit = audits[0] ? await client.get<AuditDetail>(`/api/projects/${pid}/audits/${audits[0].id}`) : undefined;
      // Scope initialises project state on first read, so only ask once an audit exists.
      const scope = audit ? await client.get<ScopeItem[]>(`/api/projects/${pid}/scope`).catch(() => undefined) : undefined;
      if (this.client !== client) return;
      this.meta = meta;
      this.project = projects.find((p) => p.id === pid) ?? this.project;
      this.audit = audit;
      this.scope = scope;
      this.loadError = undefined;
    } catch (e) {
      if (this.client !== client) return;
      this.loadError = (e as Error).message;
      this.output.appendLine(`[assay] refresh failed: ${this.loadError}`);
    }
    this.changeEmitter.fire();
  }

  findingById(id: string) {
    return this.findings.find((f) => f.id === id);
  }

  dispose() {
    this.disconnect();
    this.changeEmitter.dispose();
    this.jobEmitter.dispose();
  }
}
