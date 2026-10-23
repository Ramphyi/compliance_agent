import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

/** Hash routes of the Acai dashboard SPA. */
export function dashboardRoute(projectId?: string, findingId?: string) {
  if (!projectId) return "";
  const p = `#/p/${encodeURIComponent(projectId)}`;
  return findingId ? `${p}/findings/${encodeURIComponent(findingId)}` : p;
}

/** The server URL as the webview (and the browser) can reach it; differs from 127.0.0.1 in remote setups. */
export async function externalBase(port: number) {
  const ext = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${port}/`));
  const s = ext.toString(true);
  return s.endsWith("/") ? s : `${s}/`;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One reusable webview panel that frames the dashboard served by the local Acai server. */
export class DashboardPanel implements vscode.Disposable {
  static readonly viewType = "acai.dashboard";
  private panel?: vscode.WebviewPanel;
  private base?: string;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get isOpen() {
    return Boolean(this.panel);
  }

  async show(port: number, projectId?: string, findingId?: string) {
    const base = await externalBase(port);
    const url = base + dashboardRoute(projectId, findingId);
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active);
      if (this.base === base) {
        if (findingId) void this.panel.webview.postMessage({ type: "navigate", url });
        return;
      }
    } else {
      this.panel = vscode.window.createWebviewPanel(DashboardPanel.viewType, "Acai Dashboard", vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      });
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "acai.svg");
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.base = undefined;
      });
    }
    this.base = base;
    this.panel.webview.html = this.frameHtml(base, url);
  }

  /** The server restarted (new port) or stopped: point an open panel at the new address. */
  async serverChanged(port: number | undefined, projectId?: string) {
    if (!this.panel) return;
    if (!port) {
      this.base = undefined;
      this.panel.webview.html = this.messageHtml("The Acai server is not running. Run “Acai: Restart Server” or check the Acai output.");
      return;
    }
    const base = await externalBase(port);
    if (base === this.base) return;
    this.base = base;
    this.panel.webview.html = this.frameHtml(base, base + dashboardRoute(projectId));
  }

  private frameHtml(base: string, url: string) {
    const origin = new URL(base).origin;
    const nonce = randomBytes(16).toString("base64");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Acai Dashboard</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: var(--vscode-editor-background); }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<iframe id="dashboard" src="${escapeAttr(url)}" title="Acai Dashboard" allow="clipboard-read; clipboard-write"></iframe>
<script nonce="${nonce}">
  const frame = document.getElementById("dashboard");
  const base = ${JSON.stringify(base)};
  window.addEventListener("message", (e) => {
    if (e.source === frame.contentWindow) return;
    const m = e.data;
    if (m && m.type === "navigate" && typeof m.url === "string" && m.url.startsWith(base)) frame.src = m.url;
  });
</script>
</body>
</html>`;
  }

  private messageHtml(text: string) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:2rem}</style></head>
<body><p>${escapeAttr(text)}</p></body></html>`;
  }

  dispose() {
    this.panel?.dispose();
  }
}
