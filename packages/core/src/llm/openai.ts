import OpenAI from "openai";
import type { ResponseInputItem, ResponseOutputItem, Tool } from "openai/resources/responses/responses";
import { presetById } from "./catalog";
import {
  type AgentResult,
  type AgentRun,
  executeTool,
  jsonSchemaOf,
  type LlmProvider,
  type ProviderConfig,
} from "./provider";

const DEFAULT_MODEL = "gpt-5.5";

/**
 * OpenAI's own API through the Responses API: function tools, built-in web search for research,
 * and reasoning items carried between turns. Runs with store=false (nothing kept server-side);
 * the conversation, including encrypted reasoning, is replayed each turn. Azure OpenAI in
 * Microsoft Foundry speaks the same v1 API, with a deployment name as the model.
 */
export class OpenAIResponsesProvider implements LlmProvider {
  readonly id = "openai" as const;
  readonly model: string;
  readonly supportsWebSearch: boolean;
  readonly destination: string;
  private client: OpenAI;
  private effort: NonNullable<ProviderConfig["effort"]>;
  /** Off after a deployment rejects reasoning options (models without reasoning). */
  private reasoning = true;

  constructor(cfg: ProviderConfig, deps: { client?: OpenAI } = {}) {
    const preset = presetById(cfg.preset);
    const foundry = preset?.group === "azure";
    if (foundry && !deps.client && !cfg.baseURL) throw new Error(`${preset.label} needs your resource endpoint (${preset.endpointHint}), or set ${preset.endpointEnv?.join(" or ")}`);
    if (foundry && !cfg.model) throw new Error(`Enter the deployment name for ${preset.label} (ACAI_MODEL)`);
    // Without a key the SDK would read OPENAI_API_KEY and send it to Azure.
    if (foundry && !deps.client && !cfg.apiKey) throw new Error(`${preset.label} needs the key of your Foundry resource (${preset.keyEnv})`);
    this.model = cfg.model || DEFAULT_MODEL;
    this.effort = cfg.effort ?? "medium";
    this.supportsWebSearch = preset?.webSearch ?? true;
    this.client = deps.client ?? new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, maxRetries: 3, timeout: 10 * 60_000 });
    this.destination = foundry
      ? `Microsoft Foundry (${new URL(cfg.baseURL ?? "https://unknown").host}), deployment ${this.model}`
      : `OpenAI API (${cfg.baseURL || "api.openai.com"}), model ${this.model}`;
  }

  async run(run: AgentRun): Promise<AgentResult> {
    const tools: Tool[] = run.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: jsonSchemaOf(t.schema),
      strict: false,
    }));
    if (run.webSearch && this.supportsWebSearch) tools.push({ type: "web_search" });
    else if (run.webSearch) run.onEvent?.({ type: "notice", message: "Web research is not available with this provider; using the built-in registry only." });
    const input: ResponseInputItem[] = [{ role: "user", content: run.prompt }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    const texts: string[] = [];

    for (let turn = 1; turn <= run.maxTurns; turn++) {
      if (run.signal?.aborted) return { text: texts.join("\n"), turns: turn - 1, usage, stopReason: "aborted" };
      let res: OpenAI.Responses.Response;
      try {
        res = await this.client.responses.create(
          {
            model: this.model,
            instructions: run.system,
            input,
            tools,
            store: false,
            ...(this.reasoning ? { include: ["reasoning.encrypted_content" as const], reasoning: { effort: this.effort } } : {}),
            parallel_tool_calls: true,
          },
          { signal: run.signal },
        );
      } catch (err) {
        // Deployments of models without reasoning (gpt-4.1, some Foundry models) reject these options.
        if (this.reasoning && err instanceof OpenAI.BadRequestError && /reasoning|encrypted_content/i.test(err.message)) {
          this.reasoning = false;
          run.onEvent?.({ type: "notice", message: `${this.model} does not take reasoning options; continuing without them.` });
          turn--;
          continue;
        }
        throw err;
      }
      usage.inputTokens += res.usage?.input_tokens ?? 0;
      usage.outputTokens += res.usage?.output_tokens ?? 0;
      run.onEvent?.({ type: "turn", turn, ...usage });

      const output = res.output as ResponseOutputItem[];
      for (const item of output) {
        if (item.type === "message")
          for (const c of item.content)
            if (c.type === "output_text" && c.text.trim()) {
              texts.push(c.text);
              run.onEvent?.({ type: "text", text: c.text });
            } else if (c.type === "refusal") {
              run.onEvent?.({ type: "notice", message: `The model refused: ${c.refusal}` });
              return { text: texts.join("\n"), turns: turn, usage, stopReason: "refusal" };
            }
        if (item.type === "web_search_call") {
          const action = (item as { action?: { query?: string; queries?: string[] } }).action;
          run.onEvent?.({ type: "search", query: action?.query ?? action?.queries?.join("; ") ?? "" });
        }
      }
      // Replay everything the model produced (reasoning, calls, messages) on the next turn.
      input.push(...(output as unknown as ResponseInputItem[]));

      const calls = output.filter((i): i is Extract<ResponseOutputItem, { type: "function_call" }> => i.type === "function_call");
      if (!calls.length) {
        if (res.status === "incomplete") run.onEvent?.({ type: "notice", message: `Response incomplete: ${res.incomplete_details?.reason ?? "unknown"}` });
        return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
      }
      let finished = false;
      for (const call of calls) {
        let args: unknown;
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = { INVALID_JSON: call.arguments };
        }
        const r = await executeTool(run.tools, call.name, args);
        run.onEvent?.({ type: "tool", name: call.name, input: args, result: r.content, isError: r.isError });
        input.push({ type: "function_call_output", call_id: call.call_id, output: r.isError ? `ERROR: ${r.content}` : r.content });
        if (!r.isError && call.name === run.finishTool) finished = true;
      }
      if (finished) return { text: texts.join("\n"), turns: turn, usage, stopReason: "done" };
    }
    return { text: texts.join("\n"), turns: run.maxTurns, usage, stopReason: "max_turns" };
  }
}
