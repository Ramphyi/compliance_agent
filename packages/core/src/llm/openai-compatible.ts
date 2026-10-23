import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { presetById, type ProviderPreset, sanitizeSchema } from "./catalog";
import {
  type AgentResult,
  type AgentRun,
  executeTool,
  jsonSchemaOf,
  type LlmProvider,
  type ProviderConfig,
} from "./provider";

/**
 * Any OpenAI-compatible Chat Completions endpoint: hosted providers (Gemini, OpenRouter, Mistral,
 * Groq, DeepSeek, xAI, Together) and self-hosted models (Ollama, vLLM, LM Studio, a gateway),
 * which lets Acai run fully on-premise. Web research is not available through this provider.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible" as const;
  readonly model: string;
  readonly supportsWebSearch = false;
  readonly destination: string;
  private client: OpenAI;
  private dialect: ProviderPreset["schema"];

  constructor(cfg: ProviderConfig) {
    const preset = presetById(cfg.preset);
    if (!cfg.baseURL) throw new Error(`An endpoint URL is required for ${preset?.label ?? "the openai-compatible provider"} (ACAI_OPENAI_BASE_URL)`);
    if (!cfg.model) throw new Error(`Choose a model for ${preset?.label ?? "the openai-compatible provider"} (ACAI_MODEL)`);
    this.model = cfg.model;
    this.dialect = preset?.schema;
    this.client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey || "not-needed", maxRetries: 3, timeout: 10 * 60_000 });
    const name = preset && preset.id !== "openai-compatible" ? preset.label : "OpenAI-compatible endpoint";
    this.destination = `${name} at ${cfg.baseURL}, model ${this.model}`;
  }

  async run(run: AgentRun): Promise<AgentResult> {
    if (run.webSearch) run.onEvent?.({ type: "notice", message: "Web research is not available with this provider; using the built-in registry only." });
    const tools: ChatCompletionTool[] = run.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: sanitizeSchema(jsonSchemaOf(t.schema), this.dialect) },
    }));
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: run.system },
      { role: "user", content: run.prompt },
    ];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const texts: string[] = [];
    for (let turn = 1; turn <= run.maxTurns; turn++) {
      if (run.signal?.aborted) return { text: texts.join("\n"), turns: turn - 1, usage, stopReason: "aborted" };
      const res = await this.client.chat.completions.create({ model: this.model, messages, tools }, { signal: run.signal });
      usage.inputTokens += res.usage?.prompt_tokens ?? 0;
      usage.outputTokens += res.usage?.completion_tokens ?? 0;
      run.onEvent?.({ type: "turn", turn, ...usage });
      const choice = res.choices[0];
      const m = choice.message;
      if (m.content?.trim()) {
        texts.push(m.content);
        run.onEvent?.({ type: "text", text: m.content });
      }
      messages.push(m);
      const calls = (m.tool_calls ?? []).filter((c) => c.type === "function");
      if (!calls.length) return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
      let finished = false;
      for (const call of calls) {
        let input: unknown;
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = { INVALID_JSON: call.function.arguments };
        }
        const r = await executeTool(run.tools, call.function.name, input);
        run.onEvent?.({ type: "tool", name: call.function.name, input, result: r.content, isError: r.isError });
        messages.push({ role: "tool", tool_call_id: call.id, content: r.isError ? `ERROR: ${r.content}` : r.content });
        if (!r.isError && call.function.name === run.finishTool) finished = true;
      }
      if (finished) return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
    }
    return { text: texts.join("\n"), turns: run.maxTurns, usage, stopReason: "max_turns" };
  }
}
