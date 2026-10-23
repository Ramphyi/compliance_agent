import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { presetBaseURL, presetById, presetEndpointFromEnv, type ProviderConfig, providerConfigFromEnv, type ProviderPreset } from "@acai/core";
import { acaiHome } from "./projects";

/** The model chosen in the dashboard. Overrides the environment until it is reset. */
export type ModelSettings = { preset: string; model?: string; baseURL?: string; apiKey?: string; effort?: ProviderConfig["effort"] };

const file = () => join(acaiHome(), "model.json");

export function readModelSettings(): ModelSettings | null {
  try {
    return JSON.parse(readFileSync(file(), "utf8")) as ModelSettings;
  } catch {
    return null;
  }
}

/** Saved with owner-only permissions: it may hold an API key. */
export function writeModelSettings(s: ModelSettings | null) {
  if (!s) return rmSync(file(), { force: true });
  mkdirSync(dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
  renameSync(tmp, file());
}

/** Inside the container, "localhost" is the container itself: local model servers run on the host. */
export function defaultBaseURL(p: ProviderPreset, env = process.env) {
  return p.baseURL && env.ACAI_CONTAINER === "1" ? p.baseURL.replace("://localhost:", "://host.docker.internal:") : p.baseURL;
}

/** A key typed in the dashboard wins; otherwise the preset's environment variable. */
export function configFromSettings(s: ModelSettings, env = process.env): ProviderConfig {
  const preset = presetById(s.preset);
  if (!preset) return { provider: "none" };
  return {
    provider: preset.engine,
    preset: preset.id,
    model: s.model || preset.defaultModel,
    baseURL: presetBaseURL(preset, s.baseURL) || defaultBaseURL(preset, env) || presetEndpointFromEnv(preset, env),
    apiKey: s.apiKey || (preset.keyEnv ? env[preset.keyEnv] : undefined) || (preset.id === "openai-compatible" ? env.OPENAI_API_KEY : undefined),
    effort: s.effort,
  };
}

/** Dashboard settings when saved (and not locked by the administrator), else the environment. */
export function resolveProviderConfig(env = process.env): { config: ProviderConfig; source: "settings" | "environment" } {
  const saved = env.ACAI_MODEL_LOCKED === "1" ? null : readModelSettings();
  if (saved) return { config: configFromSettings(saved, env), source: "settings" };
  const config = providerConfigFromEnv(env);
  return { config: { ...config, preset: config.preset ?? (config.provider === "none" ? undefined : config.provider) }, source: "environment" };
}
