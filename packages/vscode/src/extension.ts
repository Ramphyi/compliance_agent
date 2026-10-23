import * as vscode from "vscode";
import * as actions from "./actions";
import { LAUNCH_SETTINGS, OPENAI_SECRET_KEY, SECRET_KEY } from "./config";
import { dashboardRoute, DashboardPanel, externalBase } from "./dashboard";
import { FindingCodeActions, FindingDiagnostics, FindingsTreeProvider, StatusTreeProvider } from "./findings";
import { registerMcpProvider } from "./mcp";
import { ServerManager } from "./server";
import { AcaiState } from "./state";

const setContext = (key: string, value: unknown) => void vscode.commands.executeCommand("setContext", key, value);

/** The folder Acai audits: the remembered choice, else the first workspace folder. */
function pickFolder(context: vscode.ExtensionContext): string | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const remembered = context.workspaceState.get<string>("acai.folder");
  const match = folders.find((f) => f.uri.fsPath === remembered) ?? folders.find((f) => f.uri.scheme === "file");
  return match?.uri.fsPath;
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Acai");
  const server = new ServerManager(context, output);
  const state = new AcaiState(server, output);
  const dashboard = new DashboardPanel(context.extensionUri);
  const diagnostics = new FindingDiagnostics(state);
  const findingsTree = new FindingsTreeProvider(state);
  const statusTree = new StatusTreeProvider(state, () => ({ state: server.state, url: server.url, error: server.error }));
  const findingsView = vscode.window.createTreeView("acai.findings", { treeDataProvider: findingsTree, showCollapseAll: true });
  const statusView = vscode.window.createTreeView("acai.status", { treeDataProvider: statusTree });
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "acai.openDashboard";
  context.subscriptions.push(output, server, state, dashboard, diagnostics, findingsView, statusView, statusBar);

  let folder = pickFolder(context);
  const mcp = registerMcpProvider(context, () => folder, (line) => output.appendLine(line));

  const start = async () => {
    setContext("acai.hasFolder", Boolean(folder));
    if (!folder) {
      await server.stop();
      return;
    }
    if (!vscode.workspace.isTrusted) {
      output.appendLine("[acai] the workspace is not trusted; the Acai server will start once you trust it");
      return;
    }
    try {
      await server.restart(folder);
    } catch (e) {
      void actions.showError(e, "Acai server");
    }
  };

  const ctx: actions.ActionContext = {
    state,
    context,
    output,
    openDashboard: async (findingId?: string) => {
      if (!server.port) {
        void vscode.window.showWarningMessage("The Acai server is not running.", "Restart Server").then((c) => c && start());
        return;
      }
      await dashboard.show(server.port, state.projectId, findingId);
    },
    revealFindings: () => void vscode.commands.executeCommand("acai.findings.focus"),
  };

  const updateUi = () => {
    findingsTree.refresh();
    statusTree.refresh();
    diagnostics.update();
    setContext("acai.hasAudit", Boolean(state.audit));
    const pending = state.findings.filter((f) => f.status === "open" || f.status === "reinvestigating").length;
    const fixes = state.findings.filter((f) => f.status === "fix_ready").length;
    findingsView.badge = pending ? { value: pending, tooltip: `${pending} finding(s) need a decision` } : undefined;
    if (server.state === "running" && state.audit) {
      statusBar.text = `$(shield) Acai: ${pending} to review${fixes ? `, ${fixes} fix${fixes > 1 ? "es" : ""}` : ""}`;
      statusBar.tooltip = "Open the Acai dashboard";
      statusBar.show();
    } else if (server.state === "starting") {
      statusBar.text = "$(sync~spin) Acai";
      statusBar.tooltip = "Starting the Acai server";
      statusBar.show();
    } else if (server.state === "error") {
      statusBar.text = "$(error) Acai";
      statusBar.tooltip = server.error ?? "The Acai server stopped";
      statusBar.command = "acai.restartServer";
      statusBar.show();
      return;
    } else statusBar.hide();
    statusBar.command = "acai.openDashboard";
  };
  context.subscriptions.push(state.onDidChange(updateUi));

  context.subscriptions.push(
    server.onDidChangeState((s) => {
      setContext("acai.serverState", s);
      updateUi();
      if (s === "running") void state.connect(folder);
      else if (s !== "starting") void state.connect(undefined);
      void dashboard.serverChanged(s === "running" ? server.port : undefined, state.projectId);
    }),
  );

  const cmd = (id: string, fn: (...args: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  cmd("acai.openDashboard", (arg) => ctx.openDashboard(actions.findingIdFrom(arg)));
  cmd("acai.openDashboardExternal", async (arg) => {
    if (!server.port) return;
    const base = await externalBase(server.port);
    await vscode.env.openExternal(vscode.Uri.parse(base + dashboardRoute(state.projectId, actions.findingIdFrom(arg))));
  });
  cmd("acai.runAudit", () => actions.runAudit(ctx));
  cmd("acai.runAgentAudit", () => actions.runAgentAudit(ctx));
  cmd("acai.refresh", () => state.refresh());
  cmd("acai.confirmFinding", (arg) => actions.confirmFinding(ctx, arg));
  cmd("acai.rejectFinding", (arg) => actions.rejectFinding(ctx, arg));
  cmd("acai.reinvestigateFinding", (arg) => actions.reinvestigateFinding(ctx, arg));
  cmd("acai.modifyFinding", (arg) => actions.modifyFinding(ctx, arg));
  cmd("acai.openFindingLocation", (arg) => actions.openFindingLocation(ctx, arg));
  cmd("acai.fixConfirmed", () => actions.fixConfirmed(ctx));
  cmd("acai.acceptFix", (arg) => actions.acceptFix(ctx, arg));
  cmd("acai.revertFix", (arg) => actions.revertFix(ctx, arg));
  cmd("acai.showReport", () => actions.showReport(ctx));
  cmd("acai.restartServer", () => start());
  cmd("acai.setApiKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "Anthropic API key for Acai",
      prompt: "Stored in VS Code's secret storage and passed only to the local Acai server. Code excerpts are sent to the Anthropic API only when you run agent features.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length < 20 ? "That does not look like an API key." : undefined),
    });
    if (key) await context.secrets.store(SECRET_KEY, key.trim());
  });
  cmd("acai.setOpenAIKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "OpenAI API key for Acai",
      prompt: "Stored in VS Code's secret storage and passed only to the local Acai server. Code excerpts are sent to the OpenAI API only when you run agent features.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().length < 20 ? "That does not look like an API key." : undefined),
    });
    if (key) await context.secrets.store(OPENAI_SECRET_KEY, key.trim());
  });
  cmd("acai.clearApiKey", async () => {
    await context.secrets.delete(SECRET_KEY);
    await context.secrets.delete(OPENAI_SECRET_KEY);
    void vscode.window.showInformationMessage("Acai: the API keys were removed.");
  });
  cmd("acai.selectFolder", async () => {
    const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: "Folder to audit with Acai" });
    if (!pick || pick.uri.fsPath === folder) return;
    folder = pick.uri.fsPath;
    await context.workspaceState.update("acai.folder", folder);
    mcp.changed();
    await start();
  });

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new FindingCodeActions(state), { providedCodeActionKinds: FindingCodeActions.kinds }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (LAUNCH_SETTINGS.some((s) => e.affectsConfiguration(s))) {
        mcp.changed();
        void start();
      } else if (e.affectsConfiguration("acai.diagnostics")) diagnostics.update();
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

  setContext("acai.serverState", "stopped");
  void start();
}

export function deactivate() {
  // Disposables registered in activate() stop the server and close the panel.
}
