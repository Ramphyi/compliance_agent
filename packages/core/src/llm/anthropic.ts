import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import {
  type AgentResult,
  type AgentRun,
  executeTool,
  jsonSchemaOf,
  type LlmProvider,
  type ProviderConfig,
} from "./provider";

const DEFAULT_MODEL = "claude-opus-5-5";
/** Models that accept the server-side `fallbacks: "default"` refusal fallback. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/**
 * Claude provider: a manual streaming tool loop, so Assay keeps control of budgets,
 * journaling and human-in-the-loop gates. Thinking blocks are passed back unchanged.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model: string;
  readonly supportsWebSearch = true;
  readonly destination: string;
  private client: Anthropic;
  private effort: NonNullable<ProviderConfig["effort"]>;
  /** A custom base URL may be a gateway that rejects newer request fields. */
  private directApi: boolean;

  /** `deps` lets tests inject a client pointed at a fake API. */
  constructor(cfg: ProviderConfig, deps: { client?: Anthropic; directApi?: boolean } = {}) {
    this.model = cfg.model || DEFAULT_MODEL;
    this.effort = cfg.effort ?? "high";
    this.directApi = deps.directApi ?? !cfg.baseURL;
    this.client = deps.client ?? new Anthropic({ baseURL: cfg.baseURL || undefined, maxRetries: 4, timeout: 15 * 60_000 });
    this.destination = `Anthropic API (${cfg.baseURL || "api.anthropic.com"}), model ${this.model}`;
  }

  async run(run: AgentRun): Promise<AgentResult> {
    const tools: BetaToolUnion[] = run.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: jsonSchemaOf(t.schema) as Anthropic.Beta.Messages.BetaTool.InputSchema,
      ...(this.directApi ? { eager_input_streaming: true } : {}),
    }));
    if (run.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 10 });

    const fallbacks = this.directApi && process.env.ASSAY_FALLBACKS !== "off" && FALLBACK_MODELS.has(this.model);
    const messages: BetaMessageParam[] = [{ role: "user", content: run.prompt }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const texts: string[] = [];
    let jsonRetries = 0;

    for (let turn = 1; turn <= run.maxTurns; turn++) {
      if (run.signal?.aborted) return { text: texts.join("\n"), turns: turn - 1, usage, stopReason: "aborted" };
      let msg: BetaMessage;
      try {
        const stream = this.client.beta.messages.stream(
          {
            model: this.model,
            max_tokens: 64_000,
            system: [{ type: "text", text: run.system, cache_control: { type: "ephemeral" } }],
            tools,
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort: this.effort },
            cache_control: { type: "ephemeral" },
            ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: run.signal },
        );
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (run.signal?.aborted) return { text: texts.join("\n"), turns: turn - 1, usage, stopReason: "aborted" };
        // Only unparseable streamed tool input is retried here; API errors propagate.
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        run.onEvent?.({ type: "notice", message: "Tool input was not valid JSON; re-issuing the turn." });
        turn--;
        continue;
      }

      usage.inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
      usage.outputTokens += msg.usage.output_tokens;
      run.onEvent?.({ type: "turn", turn, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });

      for (const block of msg.content as BetaContentBlock[]) {
        if (block.type === "text" && block.text.trim()) {
          texts.push(block.text);
          run.onEvent?.({ type: "text", text: block.text });
        }
        if (block.type === "server_tool_use" && block.name === "web_search")
          run.onEvent?.({ type: "search", query: String((block.input as { query?: string }).query ?? "") });
        if (block.type === "fallback")
          run.onEvent?.({ type: "notice", message: `${block.from.model} declined; continued on ${block.to.model}.` });
      }

      if (msg.stop_reason === "refusal") {
        run.onEvent?.({ type: "notice", message: `The model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ""}.` });
        return { text: texts.join("\n"), turns: turn, usage, stopReason: "refusal" };
      }
      messages.push({ role: "assistant", content: msg.content as BetaMessageParam["content"] });
      if (msg.stop_reason === "pause_turn") continue;

      const calls = (msg.content as BetaContentBlock[]).filter((b): b is BetaToolUseBlock => b.type === "tool_use");
      if (!calls.length) return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
      if (msg.stop_reason === "max_tokens") throw new Error("A tool call was cut off by max_tokens; aborting this run.");

      const results: BetaToolResultBlockParam[] = [];
      let finished = false;
      for (const call of calls) {
        const r = await executeTool(run.tools, call.name, call.input);
        run.onEvent?.({ type: "tool", name: call.name, input: call.input, result: r.content, isError: r.isError });
        results.push({ type: "tool_result", tool_use_id: call.id, content: r.content, is_error: r.isError || undefined });
        if (!r.isError && call.name === run.finishTool) finished = true;
      }
      messages.push({ role: "user", content: results });
      if (finished) return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
    }
    return { text: texts.join("\n"), turns: run.maxTurns, usage, stopReason: "max_turns" };
  }
}
