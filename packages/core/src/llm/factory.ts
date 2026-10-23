import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AnthropicProvider } from "./anthropic";
import { FOUNDRY_CLAUDE_MODELS, presetById } from "./catalog";
import { OpenAIResponsesProvider } from "./openai";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { type LlmProvider, type ProviderConfig, providerConfigFromEnv } from "./provider";

// Static imports on purpose: dynamic import() makes bundlers wrap shared modules (zod) in lazy initialisers.
export async function createProvider(cfg: ProviderConfig = providerConfigFromEnv()): Promise<LlmProvider | null> {
  if (cfg.provider === "anthropic") return new AnthropicProvider(cfg);
  if (cfg.provider === "openai") return new OpenAIResponsesProvider(cfg);
  if (cfg.provider === "openai-compatible") return new OpenAICompatibleProvider(cfg);
  return null;
}

/**
 * The models an endpoint offers, so people pick from the real list instead of typing ids.
 * Also proves that the endpoint is reachable and the key is accepted.
 */
export async function listModels(cfg: ProviderConfig): Promise<string[]> {
  const opts = { apiKey: cfg.apiKey || undefined, baseURL: cfg.baseURL || undefined, maxRetries: 0, timeout: 20_000 };
  const ids: string[] = [];
  const preset = presetById(cfg.preset);
  // Never let the SDKs fill in api.openai.com or OPENAI_API_KEY for an Azure resource.
  if (preset?.group === "azure" && !cfg.baseURL) throw new Error(`Enter your resource endpoint (${preset.endpointHint})`);
  if (preset?.group === "azure" && !cfg.apiKey) throw new Error(`Enter the key of your Foundry resource, or set ${preset.keyEnv} on the server`);
  // No Models API there: offer the default deployment names (they equal the model ids).
  if (cfg.preset === "azure-claude") return FOUNDRY_CLAUDE_MODELS;
  if (cfg.provider === "anthropic") {
    for await (const m of new Anthropic(opts).models.list({ limit: 100 })) ids.push(m.id);
  } else if (cfg.provider === "openai" || cfg.provider === "openai-compatible") {
    const client = new OpenAI({ ...opts, apiKey: opts.apiKey ?? (cfg.provider === "openai-compatible" ? "not-needed" : undefined) });
    for await (const m of client.models.list()) ids.push(m.id);
  } else return [];
  return [...new Set(ids)].sort();
}
