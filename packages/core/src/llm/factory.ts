import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AnthropicProvider } from "./anthropic";
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
  if (cfg.provider === "anthropic") {
    for await (const m of new Anthropic(opts).models.list({ limit: 100 })) ids.push(m.id);
  } else if (cfg.provider === "openai" || cfg.provider === "openai-compatible") {
    const client = new OpenAI({ ...opts, apiKey: opts.apiKey ?? (cfg.provider === "openai-compatible" ? "not-needed" : undefined) });
    for await (const m of client.models.list()) ids.push(m.id);
  } else return [];
  return [...new Set(ids)].sort();
}
