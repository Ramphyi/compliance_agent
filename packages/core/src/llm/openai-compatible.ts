import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import {
  type AgentResult,
  type AgentRun,
  executeTool,
  jsonSchemaOf,
  type LlmProvider,
  type ProviderConfig,
} from "./provider";

/**
 * For self-hosted models behind an OpenAI-compatible endpoint (Ollama, vLLM, LM Studio,
 * an internal gateway). Lets Assay run fully on-premise with no external model provider.
 * Web research is not available through this provider.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible" as const;
  readonly model: string;
  readonly supportsWebSearch = false;
  readonly destination: string;
  private client: OpenAI;

  constructor(cfg: ProviderConfig) {
    if (!cfg.baseURL) throw new Error("ASSAY_OPENAI_BASE_URL is required for the openai-compatible provider");
    if (!cfg.model) throw new Error("ASSAY_MODEL is required for the openai-compatible provider");
    this.model = cfg.model;
    this.client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey || "not-needed", maxRetries: 3, timeout: 10 * 60_000 });
    this.destination = `OpenAI-compatible endpoint ${cfg.baseURL}, model ${this.model}`;
  }

  async run(run: AgentRun): Promise<AgentResult> {
    if (run.webSearch) run.onEvent?.({ type: "notice", message: "Web research is not available with this provider; using the built-in registry only." });
    const tools: ChatCompletionTool[] = run.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: jsonSchemaOf(t.schema) },
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
