import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider, listModels, presetBaseURL, presetById, providerConfigFromEnv } from "../packages/core/src/index";
import { AnthropicProvider } from "../packages/core/src/llm/anthropic";
import { OpenAIResponsesProvider } from "../packages/core/src/llm/openai";
import { tool } from "../packages/core/src/llm/provider";
import { configFromSettings } from "../packages/cli/src/models";

const finishTools = [tool({ name: "finish", description: "f", schema: z.object({ summary: z.string() }), run: () => "ok" })];

/** A fake Foundry resource: records each request and answers with the next scripted reply. */
function fakeResource(replies: { status?: number; type: string; body: string }[]) {
  const requests: { path: string; headers: IncomingHttpHeaders; body: Record<string, any> }[] = [];
  let server: Server;
  let origin = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        requests.push({ path: req.url ?? "", headers: req.headers, body: data ? JSON.parse(data) : {} });
        const r = replies[requests.length - 1];
        res.writeHead(r.status ?? 200, { "Content-Type": r.type });
        res.end(r.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    origin = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterAll(() => server.close());
  return { requests, origin: () => origin };
}

describe("Microsoft Foundry endpoints", () => {
  it("accepts a resource name, the resource URL or the full API URL", () => {
    const gpt = presetById("azure-openai");
    const claude = presetById("azure-claude");
    expect(presetBaseURL(gpt, "contoso")).toBe("https://contoso.openai.azure.com/openai/v1/");
    expect(presetBaseURL(gpt, "https://contoso.openai.azure.com")).toBe("https://contoso.openai.azure.com/openai/v1/");
    expect(presetBaseURL(gpt, "https://contoso.services.ai.azure.com/openai/v1")).toBe("https://contoso.services.ai.azure.com/openai/v1/");
    expect(presetBaseURL(claude, "contoso")).toBe("https://contoso.services.ai.azure.com/anthropic/");
    expect(presetBaseURL(claude, "https://contoso.services.ai.azure.com/anthropic/v1/messages")).toBe("https://contoso.services.ai.azure.com/anthropic/");
    expect(presetBaseURL(presetById("ollama"), "http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
  });

  it("reads the same environment variables as the Azure and Anthropic SDKs", () => {
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "azure-openai", AZURE_OPENAI_ENDPOINT: "https://contoso.openai.azure.com/", AZURE_OPENAI_API_KEY: "az", ACAI_MODEL: "gpt-55-prod", OPENAI_API_KEY: "sk" })).toEqual({
      provider: "openai", preset: "azure-openai", model: "gpt-55-prod", baseURL: "https://contoso.openai.azure.com/openai/v1/", apiKey: "az", effort: undefined,
    });
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "azure-claude", ANTHROPIC_FOUNDRY_RESOURCE: "contoso", ANTHROPIC_FOUNDRY_API_KEY: "fk", ANTHROPIC_API_KEY: "sk-ant" })).toMatchObject({
      provider: "anthropic", preset: "azure-claude", model: "claude-opus-5-5", baseURL: "https://contoso.services.ai.azure.com/anthropic/", apiKey: "fk",
    });
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "azure-foundry", AZURE_OPENAI_ENDPOINT: "contoso", AZURE_OPENAI_API_KEY: "az", ACAI_MODEL: "Llama-4" })).toMatchObject({
      provider: "openai-compatible", baseURL: "https://contoso.openai.azure.com/openai/v1/", model: "Llama-4",
    });
    // The dashboard's saved choice falls back to the endpoint and key from the environment.
    expect(configFromSettings({ preset: "azure-openai", model: "gpt-55-prod" }, { AZURE_OPENAI_ENDPOINT: "contoso", AZURE_OPENAI_API_KEY: "az" })).toMatchObject({
      baseURL: "https://contoso.openai.azure.com/openai/v1/", apiKey: "az",
    });
  });

  it("refuses to start without the resource, the key or the deployment name, so no other credential goes to Azure", async () => {
    await expect(createProvider({ provider: "openai", preset: "azure-openai", model: "d", apiKey: "k" })).rejects.toThrow(/endpoint/);
    await expect(createProvider({ provider: "openai", preset: "azure-openai", baseURL: "https://x.openai.azure.com/openai/v1/", apiKey: "k" })).rejects.toThrow(/deployment name/);
    await expect(createProvider({ provider: "openai", preset: "azure-openai", baseURL: "https://x.openai.azure.com/openai/v1/", model: "d" })).rejects.toThrow(/key/);
    await expect(createProvider({ provider: "anthropic", preset: "azure-claude", baseURL: "https://x.services.ai.azure.com/anthropic/" })).rejects.toThrow(/key/);
    await expect(createProvider({ provider: "openai-compatible", preset: "azure-foundry", baseURL: "https://x.openai.azure.com/openai/v1/", model: "m" })).rejects.toThrow(/key/);
    await expect(listModels({ provider: "openai", preset: "azure-openai", baseURL: "https://x.openai.azure.com/openai/v1/" })).rejects.toThrow(/key/);
    expect(await listModels({ provider: "anthropic", preset: "azure-claude", baseURL: "https://x.services.ai.azure.com/anthropic/", apiKey: "k" })).toContain("claude-opus-5-5");
  });
});

describe("Azure OpenAI in Foundry (fake resource, real SDK)", () => {
  const response = (output: object[]) => JSON.stringify({ id: "r", object: "response", created_at: 0, status: "completed", model: "gpt-4.1", output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } });
  const res = fakeResource([
    { status: 400, type: "application/json", body: JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: "invalid_request_error", param: "reasoning.effort" } }) },
    { type: "application/json", body: response([{ type: "function_call", id: "fc", call_id: "c1", name: "finish", arguments: '{"summary":"ok"}', status: "completed" }]) },
  ]);

  it("calls the deployment on the v1 API with the resource key, without web search, and retries without reasoning options", async () => {
    const provider = (await createProvider({ provider: "openai", preset: "azure-openai", baseURL: `${res.origin()}/openai/v1/`, apiKey: "azure-key", model: "gpt-41-prod" })) as OpenAIResponsesProvider;
    expect(provider.supportsWebSearch).toBe(false);
    expect(provider.destination).toMatch(/^Microsoft Foundry \(127\.0\.0\.1:\d+\), deployment gpt-41-prod$/);
    const notices: string[] = [];
    const r = await provider.run({ system: "s", prompt: "p", maxTurns: 3, webSearch: true, finishTool: "finish", tools: finishTools, onEvent: (e) => e.type === "notice" && notices.push(e.message) });
    expect(r.stopReason).toBe("done");
    const [first, second] = res.requests;
    expect(first.path).toBe("/openai/v1/responses");
    expect(first.headers.authorization).toBe("Bearer azure-key");
    expect(first.body).toMatchObject({ model: "gpt-41-prod", store: false, reasoning: { effort: "medium" } });
    expect(first.body.tools.map((t: { type: string }) => t.type)).toEqual(["function"]);
    expect(second.body.reasoning).toBeUndefined();
    expect(second.body.include).toBeUndefined();
    expect(notices.join(" ")).toMatch(/Web research is not available.*does not take reasoning options/s);
  });
});

describe("Claude in Microsoft Foundry (fake resource, real SDK)", () => {
  const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const res = fakeResource([
    {
      type: "text/event-stream",
      body: sse([
        { type: "message_start", message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "finish", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"summary":"ok"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ]),
    },
  ]);
  const env = { ...process.env };
  afterAll(() => (process.env = env));

  it("sends the Foundry key only, uses the basic web search tool and no server-side fallback", async () => {
    // Credentials for Anthropic's own API must never reach Azure.
    Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-secret", ANTHROPIC_AUTH_TOKEN: "ant-token" });
    const provider = (await createProvider({ provider: "anthropic", preset: "azure-claude", baseURL: `${res.origin()}/anthropic/`, apiKey: "foundry-key", model: "claude-opus-5-5" })) as AnthropicProvider;
    expect(provider.destination).toMatch(/^Claude in Microsoft Foundry \(127\.0\.0\.1:\d+\), deployment claude-opus-5-5$/);
    const r = await provider.run({ system: "s", prompt: "p", maxTurns: 2, webSearch: true, finishTool: "finish", tools: finishTools });
    expect(r.stopReason).toBe("done");
    const [req] = res.requests;
    expect(req.path).toBe("/anthropic/v1/messages?beta=true");
    expect(req.headers["x-api-key"]).toBe("foundry-key");
    expect(req.headers.authorization).toBeUndefined();
    expect(JSON.stringify(req.headers)).not.toContain("sk-ant-secret");
    expect(req.body.tools.find((t: { name: string }) => t.name === "web_search").type).toBe("web_search_20250305");
    expect(req.body.fallbacks).toBeUndefined();
  });
});
