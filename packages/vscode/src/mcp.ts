import * as vscode from "vscode";
import { acaiEnv, stateDirArgs } from "./config";

export const MCP_PROVIDER_ID = "acai";
const VERSION = "0.1.0";

/**
 * Publishes `acai mcp <folder>` as a stdio MCP server, so VS Code agent mode (Copilot Chat)
 * can run audits with its own model. The editor starts and stops the process itself.
 */
export function registerMcpProvider(
  context: vscode.ExtensionContext,
  folder: () => string | undefined,
  log: (line: string) => void,
): { changed(): void } {
  const emitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(emitter);
  // The API is stable from VS Code 1.101; guard anyway so older hosts still get the rest of the extension.
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== "function") {
    log("[acai] this editor has no MCP server API; the Acai MCP server is not registered (needs VS Code 1.101+)");
    return { changed: () => undefined };
  }
  const script = vscode.Uri.joinPath(context.extensionUri, "server", "acai.mjs").fsPath;
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: emitter.event,
      provideMcpServerDefinitions: async () => {
        const root = folder();
        if (!root) return [];
        const env: Record<string, string> = {
          ELECTRON_RUN_AS_NODE: "1",
          ACAI_HOME: context.globalStorageUri.fsPath,
          NO_COLOR: "1",
          ...(await acaiEnv(context.secrets)),
        };
        const def = new vscode.McpStdioServerDefinition("Acai", process.execPath, [script, "mcp", root, ...stateDirArgs(root)], env, VERSION);
        def.cwd = vscode.Uri.file(root);
        return [def];
      },
    }),
  );
  return { changed: () => emitter.fire() };
}
