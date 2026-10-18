import * as vscode from "vscode";
import * as actions from "./actions";
import { LAUNCH_SETTINGS, OPENAI_SECRET_KEY, SECRET_KEY } from "./config";
import { dashboardRoute, DashboardPanel, externalBase } from "./dashboard";
import { FindingCodeActions, FindingDiagnostics, FindingsTreeProvider, StatusTreeProvider } from "./findings";
import { registerMcpProvider } from "./mcp";
import { ServerManager } from "./server";
import { AssayState } from "./state";

const setContext = (key: string, value: unknown) => void vscode.commands.executeCommand("setContext", key, value);

/** The folder Assay audits: the remembered choice, else the first workspace folder. */
function pickFolder(context: vscode.ExtensionContext): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const remembered = context.workspaceState.get<string>("assay.folder");
  const match = folders.find((f) => f.uri.fsPath === remembered) ?? folders.find((f) => f.uri.scheme === "file");
  return match?.uri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Assay");
  const server = new ServerManager(context, output);
  const state = new AssayState(server, output);
  const dashboard = new DashboardPanel(context.extensionUri);
  const diagnostics = new FindingDiagnostics(state);
  const findingsTree = new FindingsTreeProvider(state);
  const statusTree = new StatusTreeProvider(state, () => ({ state: server.state, url: server.url, error: server.error }));
  const findingsView = vscode.window.createTreeView("assay.findings", { treeDataProvider: findingsTree, showCollapseAll: true });
  const statusView = vscode.window.createTreeView("assay.status", { treeDataProvider: statusTree });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "assay.openDashboard";
  context.subscriptions.push(output, server, state, dashboard, diagnostics, findingsView, statusView, statusBar);

  let folder = pickFolder(context);
  const mcp = registerMcpProvider(context, () => folder, (line) => output.appendLine(line));

  const start = async () => {
    setContext("assay.hasFolder", Boolean(folder));
    if (!folder) {
      await server.stop();
      return;
    }
    if (!vscode.workspace.isTrusted) {
      output.appendLine("[assay] the workspace is not trusted; the Assay server will start once you trust it");
      return;
    }
    try {
      await server.restart(folder);
    } catch (e) {
      void actions.showError(e, "Assay server");
    }
  };

  const ctx: actions.ActionContext = {
    state,
    context,
    output,
    openDashboard: async (findingId?: string) => {
      if (!server.port) {
        void vscode.window.showWarningMessage("The Assay server is not running.", "Restart Server").then((c) => c && start());
        return;
      }
      await dashboard.show(server.port, state.projectId, findingId);
    },
    revealFindings: () => void vscode.commands.executeCommand("assay.findings.focus"),
  };

  const updateUi = () => {
    findingsTree.refresh();
    statusTree.refresh();
    diagnostics.update();
    setContext("assay.hasAudit", Boolean(state.audit));
    const pending = state.findings.filter((f) => f.status === "open" || f.status === "reinvestigating").length;
    const fixes = state.findings.filter((f) => f.status === "fix_ready").length;
    findingsView.badge = pending ? { value: pending, tooltip: `${pending} finding(s) need a decision` } : undefined;
    if (server.state === "running" && state.audit) {
      statusBar.text = `$(shield) Assay: ${pending} to review${fixes ? `, ${fixes} fix${fixes > 1 ? "es" : ""}` : ""}`;
      statusBar.tooltip = "Open the Assay dashboard";
      statusBar.show();
    } else if (server.state === "starting") {
      statusBar.text = "$(sync~spin) Assay";
      statusBar.tooltip = "Starting the Assay server";
      statusBar.show();
    } else if (server.state === "error") {
      statusBar.text = "$(error) Assay";
      statusBar.tooltip = server.error ?? "The Assay server stopped";
      statusBar.command = "assay.restartServer";
      statusBar.show();
      return;
    } else statusBar.hide();
    statusBar.command = "assay.openDashboard";
  };
  context.subscriptions.push(state.onDidChange(updateUi));

  context.subscriptions.push(
    server.onDidChangeState((s) => {
      setContext("assay.serverState", s);
      updateUi();
      if (s === "running") void state.connect(folder);
      else if (s !== "starting") void state.connect(undefined);
      void dashboard.serverChanged(s === "running" ? server.port : undefined, state.projectId);
    }),
  );

  const cmd = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  cmd("assay.openDashboard", (arg) => ctx.openDashboard(actions.findingIdFrom(arg)));
  cmd("assay.openDashboardExternal", async (arg) => {
    if (!server.port) return;
    const base = await externalBase(server.port);
    await vscode.env.openExternal(vscode.Uri.parse(base + dashboardRoute(state.projectId, actions.findingIdFrom(arg))));
  });
  cmd("assay.runAudit", () => actions.runAudit(ctx));
  cmd("assay.runAgentAudit", () => actions.runAgentAudit(ctx));
  cmd("assay.refresh", () => state.refresh());
  cmd("assay.confirmFinding", (arg) => actions.confirmFinding(ctx, arg));
  cmd("assay.rejectFinding", (arg) => actions.rejectFinding(ctx, arg));
  cmd("assay.reinvestigateFinding", (arg) => actions.reinvestigateFinding(ctx, arg));
  cmd("assay.modifyFinding", (arg) => actions.modifyFinding(ctx, arg));
  cmd("assay.openFindingLocation", (arg) => actions.openFindingLocation(ctx, arg));
  cmd("assay.fixConfirmed", () => actions.fixConfirmed(ctx));
  cmd("assay.acceptFix", (arg) => actions.acceptFix(ctx, arg));
  cmd("assay.revertFix", (arg) => actions.revertFix(ctx, arg));
  cmd("assay.showReport", () => actions.showReport(ctx));
  cmd("assay.restartServer", () => start());
  cmd("assay.setApiKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "Anthropic API key for Assay",
      prompt: "Stored in VS Code's secret storage and passed only to the local Assay server. Code excerpts are sent to the Anthropic API only when you run agent features.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length < 20 ? "That does not look like an API key." : undefined),
    });
    if (key) await context.secrets.store(SECRET_KEY, key.trim());
  });
  cmd("assay.setOpenAIKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "OpenAI API key for Assay",
      prompt: "Stored in VS Code's secret storage and passed only to the local Assay server. Code excerpts are sent to the OpenAI API only when you run agent features.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length < 20 ? "That does not look like an API key." : undefined),
    });
    if (key) await context.secrets.store(OPENAI_SECRET_KEY, key.trim());
  });
  cmd("assay.clearApiKey", async () => {
    await context.secrets.delete(SECRET_KEY);
    await context.secrets.delete(OPENAI_SECRET_KEY);
    void vscode.window.showInformationMessage("Assay: the API keys were removed.");
  });
  cmd("assay.selectFolder", async () => {
    const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Folder to audit with Assay" });
    if (!pick || pick.uri.fsPath === folder) return;
    folder = pick.uri.fsPath;
    await context.workspaceState.update("assay.folder", folder);
    mcp.changed();
    await start();
  });

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new FindingCodeActions(state), { providedCodeActionKinds: FindingCodeActions.kinds }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (LAUNCH_SETTINGS.some((s) => e.affectsConfiguration(s))) {
        mcp.changed();
        void start();
      } else if (e.affectsConfiguration("assay.diagnostics")) diagnostics.update();
    }),
    context.secrets.onDidChange((e) => {
      if (e.key !== SECRET_KEY && e.key !== OPENAI_SECRET_KEY) return;
      mcp.changed();
      void start();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const next = pickFolder(context);
      if (next === folder) return;
      folder = next;
      mcp.changed();
      void start();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void start()),
  );

  setContext("assay.serverState", "stopped");
  void start();
}

export function deactivate() {
  // Disposables registered in activate() stop the server and close the panel.
}
