import { z } from "zod";
import { type Engine, presetById } from "./catalog";

export type AgentTool<T = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  run: (input: T) => Promise<string> | string;
};

export function tool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string> | string;
}): AgentTool<z.infer<S>> {
  return def as unknown as AgentTool<z.infer<S>>;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown; result: string; isError: boolean }
  | { type: "search"; query: string }
  | { type: "turn"; turn: number; inputTokens: number; outputTokens: number }
  | { type: "notice"; message: string };

export type AgentRun = {
  system: string;
  prompt: string;
  tools: AgentTool<any>[];
  maxTurns: number;
  webSearch?: boolean;
  /** Tool name that ends the run when called successfully (for example "finish"). */
  finishTool?: string;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
};

export type AgentResult = {
  text: string;
  turns: number;
  usage: { inputTokens: number; outputTokens: number };
  stopReason: "done" | "max_turns" | "refusal" | "aborted";
};

export interface LlmProvider {
  readonly id: "anthropic" | "openai" | "openai-compatible";
  readonly model: string;
  readonly supportsWebSearch: boolean;
  /** Where code excerpts are sent, shown to users before they start an agent run. */
  readonly destination: string;
  run(run: AgentRun): Promise<AgentResult>;
}

export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

const TOOL_RESULT_LIMIT = 30_000;

/** Validate and execute one tool call. Errors are returned to the model, never thrown. */
export async function executeTool(tools: AgentTool<any>[], name: string, input: unknown) {
  const t = tools.find((x) => x.name === name);
  if (!t) return { content: `Unknown tool "${name}".`, isError: true };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success)
    return {
      content: `INVALID_INPUT: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Re-issue the call with valid arguments.`,
      isError: true,
    };
  try {
    let out = await t.run(parsed.data);
    if (out.length > TOOL_RESULT_LIMIT) out = out.slice(0, TOOL_RESULT_LIMIT) + "\n[output truncated]";
    return { content: out, isError: false };
  } catch (e) {
    return { content: `Error: ${(e as Error).message}`, isError: true };
  }
}

export type ProviderConfig = {
  /** The engine. */
  provider?: Engine | "none";
  /** Catalog entry (gemini, openrouter, ollama…); defaults to the engine's own entry. */
  preset?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  baseURL?: string;
  apiKey?: string;
};

export function providerConfigFromEnv(env = process.env): ProviderConfig {
  // ACAI_PROVIDER may name any catalog entry, for example gemini, openrouter or ollama.
  const preset = presetById(env.ACAI_PROVIDER);
  if (preset && preset.engine === "openai-compatible" && preset.id !== "openai-compatible")
    return {
      provider: "openai-compatible",
      preset: preset.id,
      model: env.ACAI_MODEL,
      baseURL: env.ACAI_OPENAI_BASE_URL || preset.baseURL,
      apiKey: (preset.keyEnv && env[preset.keyEnv]) || env.ACAI_OPENAI_API_KEY || undefined,
    };
  const explicit = env.ACAI_PROVIDER as ProviderConfig["provider"] | undefined;
  // Auto: Anthropic key, else an explicit OpenAI-compatible endpoint (on-premise), else OpenAI's own API.
  const provider =
    explicit ??
    (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN
      ? "anthropic"
      : env.ACAI_OPENAI_BASE_URL
        ? "openai-compatible"
        : env.OPENAI_API_KEY
          ? "openai"
          : "none");
  return {
    provider,
    model: env.ACAI_MODEL,
    effort: env.ACAI_EFFORT as ProviderConfig["effort"],
    baseURL: provider === "openai-compatible" ? env.ACAI_OPENAI_BASE_URL : provider === "openai" ? env.OPENAI_BASE_URL : env.ANTHROPIC_BASE_URL,
    apiKey: provider === "openai-compatible" ? env.ACAI_OPENAI_API_KEY || env.OPENAI_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : undefined,
  };
}
