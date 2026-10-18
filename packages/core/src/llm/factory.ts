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
