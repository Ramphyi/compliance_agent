/**
 * Model providers Acai can use for its own agents. Each one runs on one of three engines:
 * Anthropic's Messages API, OpenAI's Responses API, or any OpenAI-compatible Chat
 * Completions endpoint (most other providers and local servers speak that).
 */
export type Engine = "anthropic" | "openai" | "openai-compatible";

export type ProviderPreset = {
  id: string;
  label: string;
  engine: Engine;
  /** Default endpoint; the person can change it. Empty for the engines' own APIs. */
  baseURL?: string;
  /** Environment variable that holds the key, read when no key is saved in the settings. */
  keyEnv?: string;
  needsKey: boolean;
  /** Model used when none is chosen. Only for the engines' own APIs; others list their models. */
  defaultModel?: string;
  webSearch: boolean;
  local?: boolean;
  /** Where to get a key or learn more. */
  docs?: string;
  /** Gemini rejects some JSON Schema keywords in function parameters. */
  schema?: "gemini";
  /** Shown together on the Model page (Microsoft Foundry's three APIs). */
  group?: "azure";
  /** The endpoint is the person's own resource: no default, and this is its format. */
  endpointHint?: string;
  /** Environment variables that may hold the endpoint (a URL or, for Azure, a resource name). */
  endpointEnv?: string[];
  /** The model field takes a deployment name, not a model id. */
  deployments?: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: "anthropic", label: "Anthropic (Claude)", engine: "anthropic", keyEnv: "ANTHROPIC_API_KEY", needsKey: true, defaultModel: "claude-opus-5-5", webSearch: true, docs: "https://console.anthropic.com" },
  { id: "openai", label: "OpenAI (GPT)", engine: "openai", keyEnv: "OPENAI_API_KEY", needsKey: true, defaultModel: "gpt-5.5", webSearch: true, docs: "https://platform.openai.com/api-keys" },
  { id: "gemini", label: "Google Gemini", engine: "openai-compatible", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/", keyEnv: "GEMINI_API_KEY", needsKey: true, webSearch: false, schema: "gemini", docs: "https://aistudio.google.com/apikey" },
  { id: "openrouter", label: "OpenRouter (hundreds of models)", engine: "openai-compatible", baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", needsKey: true, webSearch: false, docs: "https://openrouter.ai/keys" },
  { id: "mistral", label: "Mistral", engine: "openai-compatible", baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", needsKey: true, webSearch: false, docs: "https://console.mistral.ai" },
  { id: "groq", label: "Groq", engine: "openai-compatible", baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", needsKey: true, webSearch: false, docs: "https://console.groq.com/keys" },
  { id: "deepseek", label: "DeepSeek", engine: "openai-compatible", baseURL: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY", needsKey: true, webSearch: false, docs: "https://platform.deepseek.com" },
  { id: "xai", label: "xAI (Grok)", engine: "openai-compatible", baseURL: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", needsKey: true, webSearch: false, docs: "https://console.x.ai" },
  { id: "together", label: "Together AI", engine: "openai-compatible", baseURL: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", needsKey: true, webSearch: false, docs: "https://api.together.ai" },
  { id: "ollama", label: "Ollama (local)", engine: "openai-compatible", baseURL: "http://localhost:11434/v1", needsKey: false, webSearch: false, local: true, docs: "https://ollama.com" },
  { id: "lmstudio", label: "LM Studio (local)", engine: "openai-compatible", baseURL: "http://localhost:1234/v1", needsKey: false, webSearch: false, local: true, docs: "https://lmstudio.ai" },
  { id: "openai-compatible", label: "Other OpenAI-compatible endpoint (vLLM, LiteLLM, a gateway…)", engine: "openai-compatible", keyEnv: "ACAI_OPENAI_API_KEY", needsKey: false, webSearch: false },
  // Microsoft Foundry (formerly Azure AI Foundry): the same resource answers on the OpenAI v1 API and,
  // for Claude deployments, on the Anthropic Messages API. Models are addressed by deployment name.
  {
    id: "azure-openai", label: "Azure OpenAI in Foundry (GPT; also DeepSeek, Grok)", engine: "openai", group: "azure", keyEnv: "AZURE_OPENAI_API_KEY", needsKey: true, webSearch: false,
    endpointHint: "https://YOUR-RESOURCE.openai.azure.com/openai/v1/", endpointEnv: ["AZURE_OPENAI_ENDPOINT"], deployments: true,
    docs: "https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle",
  },
  {
    id: "azure-foundry", label: "Other Foundry models (Llama, Mistral, Phi…)", engine: "openai-compatible", group: "azure", keyEnv: "AZURE_OPENAI_API_KEY", needsKey: true, webSearch: false,
    endpointHint: "https://YOUR-RESOURCE.services.ai.azure.com/openai/v1/", endpointEnv: ["AZURE_OPENAI_ENDPOINT"], deployments: true,
    docs: "https://learn.microsoft.com/azure/foundry/openai/api-version-lifecycle",
  },
  {
    id: "azure-claude", label: "Claude in Microsoft Foundry", engine: "anthropic", group: "azure", keyEnv: "ANTHROPIC_FOUNDRY_API_KEY", needsKey: true, defaultModel: "claude-opus-5-5", webSearch: true,
    endpointHint: "https://YOUR-RESOURCE.services.ai.azure.com/anthropic/", endpointEnv: ["ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_FOUNDRY_RESOURCE"], deployments: true,
    docs: "https://platform.claude.com/docs/en/build-with-claude/claude-in-microsoft-foundry",
  },
];

/** Claude in Foundry has no Models API: its default deployment names are the model ids. */
export const FOUNDRY_CLAUDE_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5"];

/**
 * The API base URL for a preset whose endpoint is the person's own resource. Accepts what the
 * Foundry portal shows: a bare resource name, the resource URL, or the full API URL.
 */
export function presetBaseURL(p: ProviderPreset | undefined, value?: string): string | undefined {
  const v = value?.trim();
  if (!v || !p?.group) return v || undefined;
  const claude = p.engine === "anthropic";
  if (!v.includes("://")) return claude ? `https://${v}.services.ai.azure.com/anthropic/` : `https://${v}.openai.azure.com/openai/v1/`;
  const u = new URL(v);
  const suffix = claude ? "/anthropic/" : "/openai/v1/";
  return u.pathname.replace(/\/+$/, "/").endsWith(suffix) ? u.href : `${u.origin}${suffix}`;
}

/** A preset's endpoint from the environment, if one of its variables is set. */
export const presetEndpointFromEnv = (p: ProviderPreset | undefined, env: NodeJS.ProcessEnv = process.env) =>
  presetBaseURL(p, p?.endpointEnv?.map((k) => env[k]).find(Boolean));

export const presetById = (id?: string) => PROVIDER_PRESETS.find((p) => p.id === id);

/** Every environment variable that may hold a model key (removed from verification commands). */
export const MODEL_KEY_ENVS = [...new Set(PROVIDER_PRESETS.map((p) => p.keyEnv).filter(Boolean) as string[])];

/** Gemini's function declarations accept an OpenAPI subset: no additionalProperties, $schema or const. */
export function sanitizeSchema(schema: Record<string, unknown>, dialect?: ProviderPreset["schema"]): Record<string, unknown> {
  if (dialect !== "gemini") return schema;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "additionalProperties" || k === "$schema" || k === "default") continue;
      if (k === "const") out.enum = [val];
      else out[k] = walk(val);
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}
