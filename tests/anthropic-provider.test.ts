import { createServer, type Server } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "../packages/core/src/llm/anthropic";
import { tool } from "../packages/core/src/llm/provider";

// A fake Messages API that streams real SSE events, so the SDK and our loop run unmodified.
const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const start = (id: string) => ({ type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 50, output_tokens: 1 } } });
const toolUse = (index: number, id: string, name: string, input: object) => [
  { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
  { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
  { type: "content_block_stop", index },
];
const end = (reason: string) => [{ type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 30 } }, { type: "message_stop" }];

const responses = [
  sse([start("m1"), { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking at the files." } }, { type: "content_block_stop", index: 0 }, ...toolUse(1, "toolu_1", "count", { word: "brake" }), ...toolUse(2, "toolu_2", "count", { wrong: true }), ...end("tool_use")]),
  sse([start("m2"), ...toolUse(0, "toolu_3", "finish", { summary: "done" }), ...end("tool_use")]),
];

describe("Anthropic provider loop (fake API, real SDK)", () => {
  let server: Server;
  let url = "";
  const requests: { headers: Record<string, unknown>; body: Record<string, any> }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        requests.push({ headers: req.headers, body: JSON.parse(data) });
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(responses[requests.length - 1]);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterAll(() => server.close());

  it("runs tools, validates inputs, returns errors to the model, and stops at the finish tool", async () => {
    const provider = new AnthropicProvider({ provider: "anthropic" }, { client: new Anthropic({ apiKey: "test", baseURL: url, maxRetries: 0 }), directApi: true });
    const seen: string[] = [];
    const result = await provider.run({
      system: "You audit code.",
      prompt: "Count things.",
      maxTurns: 5,
      finishTool: "finish",
      tools: [
        tool({ name: "count", description: "Count a word", schema: z.object({ word: z.string() }), run: ({ word }) => (seen.push(word), `3 x ${word}`) }),
        tool({ name: "finish", description: "Finish", schema: z.object({ summary: z.string() }), run: () => "ok" }),
      ],
    });
    expect(result.stopReason).toBe("done");
    expect(result.turns).toBe(2);
    expect(result.text).toContain("Looking at the files.");
    expect(seen).toEqual(["brake"]);

    const first = requests[0];
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.thinking).toEqual({ type: "adaptive" });
    expect(first.body.output_config).toEqual({ effort: "high" });
    expect(first.body.fallbacks).toBe("default");
    expect(String(first.headers["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(first.body.tools[0]).toMatchObject({ name: "count", eager_input_streaming: true, input_schema: { type: "object" } });
    expect(first.body.system[0].cache_control).toEqual({ type: "ephemeral" });

    // Second request carries the assistant turn back unchanged plus both tool results in one user message.
    const second = requests[1].body.messages;
    expect(second[1].role).toBe("assistant");
    const results = second[2].content;
    expect(results.map((r: { tool_use_id: string }) => r.tool_use_id)).toEqual(["toolu_1", "toolu_2"]);
    expect(results[0].content).toBe("3 x brake");
    expect(results[1].is_error).toBe(true);
    expect(results[1].content).toMatch(/INVALID_INPUT/);
  });
});
