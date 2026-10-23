import { userInfo } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export const SECRET_KEY = "acai.anthropicApiKey";
export const OPENAI_SECRET_KEY = "acai.openaiApiKey";

/** Settings that change how the server and the MCP server are launched. */
export const LAUNCH_SETTINGS = ["acai.provider", "acai.model", "acai.openaiBaseUrl", "acai.stateDir"];

export type Settings = {
  provider: "auto" | "anthropic" | "openai" | "openai-compatible" | "none";
  model: string;
  openaiBaseUrl: string;
  stateDir: string;
  diagnostics: boolean;
  reviewerName: string;
};

export function settings(): Settings {
  const c = vscode.workspace.getConfiguration("acai");
  return {
    provider: c.get<Settings["provider"]>("provider", "auto"),
    model: c.get<string>("model", "").trim(),
    openaiBaseUrl: c.get<string>("openaiBaseUrl", "").trim(),
    stateDir: c.get<string>("stateDir", "").trim(),
    diagnostics: c.get<boolean>("diagnostics", true),
    reviewerName: c.get<string>("reviewerName", "").trim(),
  };
}

export function reviewerName() {
  const name = settings().reviewerName;
  if (name) return name;
  try {
    return userInfo().username;
  } catch {
    return "reviewer";
  }
}

/** acai.stateDir resolved against the folder; supports ~ and ${workspaceFolder}. */
export function resolveStateDir(folder: string, s = settings()): string | undefined {
  if (!s.stateDir) return undefined;
  let dir = s.stateDir.replace(/\$\{workspaceFolder\}/g, folder);
  if (dir === "~" || dir.startsWith("~/")) dir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", dir.slice(1));
  return path.resolve(folder, dir);
}

/** Environment for the Acai processes: model provider settings and the API key from SecretStorage. */
export async function acaiEnv(secrets: vscode.SecretStorage, s = settings()): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const key = await secrets.get(SECRET_KEY);
  if (key) env.ANTHROPIC_API_KEY = key;
  const openaiKey = await secrets.get(OPENAI_SECRET_KEY);
  if (openaiKey) env.OPENAI_API_KEY = openaiKey;
  if (s.provider !== "auto") env.ACAI_PROVIDER = s.provider;
  if (s.model) env.ACAI_MODEL = s.model;
  if (s.openaiBaseUrl) env.ACAI_OPENAI_BASE_URL = s.openaiBaseUrl;
  return env;
}

/** Arguments shared by `serve` and `mcp`. */
export function stateDirArgs(folder: string): string[] {
  const dir = resolveStateDir(folder);
  return dir ? ["--state-dir", dir] : [];
}

export const samePath = (a: string, b: string) => {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === "win32" || process.platform === "darwin" ? na.toLowerCase() === nb.toLowerCase() : na === nb;
};
