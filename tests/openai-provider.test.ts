import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { providerConfigFromEnv } from "../packages/core/src/llm/provider";
import { OpenAIResponsesProvider } from "../packages/core/src/llm/openai";
import { tool } from "../packages/core/src/llm/provider";

const response = (id: string, output: object[]) => ({
  id, object: "response", created_at: 0, status: "completed", model: "gpt-5.5", output,
  usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
});

const replies = [
  response("r1", [
    { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "ENCRYPTED" },
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "EU AI Act Art. 50" } },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "count", arguments: '{"word":"brake"}', status: "completed" },
    { type: "function_call", id: "fc_2", call_id: "call_2", name: "count", arguments: "{not json", status: "completed" },
  ]),
  response("r2", [{ type: "function_call", id: "fc_3", call_id: "call_3", name: "finish", arguments: '{"summary":"done"}', status: "completed" }]),
];

describe("OpenAI Responses provider (fake API, real SDK)", () => {
  let server: Server;
  let url = "";
  const bodies: Record<string, any>[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        bodies.push(JSON.parse(data));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(replies[bodies.length - 1]));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/v1`;
  });
  afterAll(() => server.close());

  it("runs function tools, reports web searches, replays reasoning and never stores responses", async () => {
    const provider = new OpenAIResponsesProvider({ provider: "openai" }, { client: new OpenAI({ apiKey: "test", baseURL: url, maxRetries: 0 }) });
    const seen: string[] = [];
    const searches: string[] = [];
    const r = await provider.run({
      system: "sys",
      prompt: "go",
      maxTurns: 4,
      webSearch: true,
      finishTool: "finish",
      tools: [
        tool({ name: "count", description: "c", schema: z.object({ word: z.string() }), run: ({ word }) => (seen.push(word), `3 x ${word}`) }),
        tool({ name: "finish", description: "f", schema: z.object({ summary: z.string() }), run: () => "ok" }),
      ],
      onEvent: (e) => e.type === "search" && searches.push(e.query),
    });
    expect(r).toMatchObject({ stopReason: "done", turns: 2 });
    expect(seen).toEqual(["brake"]);
    expect(searches).toEqual(["EU AI Act Art. 50"]);
    const first = bodies[0];
    expect(first).toMatchObject({ model: "gpt-5.5", instructions: "sys", store: false, include: ["reasoning.encrypted_content"], reasoning: { effort: "medium" } });
    expect(first.tools.map((t: { type: string }) => t.type)).toEqual(["function", "function", "web_search"]);
    const second = bodies[1].input as { type?: string; call_id?: string; output?: string; encrypted_content?: string }[];
    expect(second.find((i) => i.type === "reasoning")?.encrypted_content).toBe("ENCRYPTED");
    const outputs = second.filter((i) => i.type === "function_call_output");
    expect(outputs.map((o) => o.call_id)).toEqual(["call_1", "call_2"]);
    expect(outputs[0].output).toBe("3 x brake");
    expect(outputs[1].output).toMatch(/^ERROR: INVALID_INPUT/);
  });

  it("picks the provider from the environment", () => {
    expect(providerConfigFromEnv({ OPENAI_API_KEY: "k" })).toMatchObject({ provider: "openai", apiKey: "k" });
    expect(providerConfigFromEnv({ OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "a" }).provider).toBe("anthropic");
    expect(providerConfigFromEnv({ ASSAY_OPENAI_BASE_URL: "http://gpu:8000/v1", ASSAY_MODEL: "qwen" })).toMatchObject({ provider: "openai-compatible", baseURL: "http://gpu:8000/v1" });
    expect(providerConfigFromEnv({}).provider).toBe("none");
  });
});
