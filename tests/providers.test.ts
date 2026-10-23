import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sanitizeSchema } from "../packages/core/src/llm/catalog";
import { providerConfigFromEnv } from "../packages/core/src/llm/provider";
import { Projects } from "../packages/cli/src/projects";
import { startServer } from "../packages/cli/src/server";
import { exampleRepo } from "./helpers";

describe("model providers", () => {
  it("selects any catalog provider from the environment", () => {
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "gemini", GEMINI_API_KEY: "g-key", ACAI_MODEL: "some-model" })).toMatchObject({
      provider: "openai-compatible",
      preset: "gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: "g-key",
      model: "some-model",
    });
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "ollama", ACAI_MODEL: "gpt-oss:20b" })).toMatchObject({ provider: "openai-compatible", baseURL: "http://localhost:11434/v1" });
    // The original variables keep working.
    expect(providerConfigFromEnv({ ANTHROPIC_API_KEY: "a" }).provider).toBe("anthropic");
    expect(providerConfigFromEnv({ ACAI_PROVIDER: "openai-compatible", ACAI_OPENAI_BASE_URL: "http://x/v1", ACAI_MODEL: "m" })).toMatchObject({ baseURL: "http://x/v1" });
  });

  it("removes the JSON Schema keywords Gemini rejects", () => {
    const out = sanitizeSchema({ type: "object", additionalProperties: false, properties: { kind: { const: "a" }, n: { type: "number", default: 1 } } }, "gemini");
    expect(out).toEqual({ type: "object", properties: { kind: { enum: ["a"] }, n: { type: "number" } } });
  });
});

describe("choosing the model in the dashboard", () => {
  const repo = exampleRepo("credit-scoring-ml");
  const home = mkdtempSync(join(tmpdir(), "acai-home-"));
  const env = { ...process.env };
  const seen: { path: string; auth?: string; body?: any }[] = [];
  let fake: Server;
  let fakeUrl = "";

  // Stands in for an OpenAI-compatible provider (here: "Gemini" at a custom endpoint).
  beforeAll(async () => {
    fake = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
        res.setHeader("Content-Type", "application/json");
        if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ object: "list", data: [{ id: "model-b", object: "model" }, { id: "model-a", object: "model" }] }));
        res.end(
          JSON.stringify({
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: "model-a",
            choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "finish", arguments: '{"summary":"done"}' } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    const a = fake.address();
    fakeUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/v1`;
    process.env.ACAI_HOME = home;
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ACAI_PROVIDER", "GEMINI_API_KEY"]) delete process.env[k];
  });
  afterAll(() => {
    process.env = env;
    fake.close();
    repo.cleanup();
    rmSync(home, { recursive: true, force: true });
  });

  it("lists the provider's models, switches the running server to it, and keeps the key on the server", async () => {
    const projects = new Projects({ persist: false });
    const p = projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", "X-Acai-Request": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      const initial: any = await (await call("GET", "/api/model")).json();
      expect(initial.source).toBe("none");
      expect(initial.presets.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining(["anthropic", "openai", "gemini", "openrouter", "ollama"]));

      const listed: any = await (await call("POST", "/api/model/models", { preset: "gemini", baseURL: fakeUrl, apiKey: "secret-key-123" })).json();
      expect(listed.models).toEqual(["model-a", "model-b"]);
      expect(seen.at(-1)!.auth).toBe("Bearer secret-key-123");

      const saved: any = await (await call("POST", "/api/model", { preset: "gemini", baseURL: fakeUrl, apiKey: "secret-key-123", model: "model-a" })).json();
      expect(saved.active).toMatchObject({ model: "model-a", webSearch: false });
      expect(saved.active.destination).toContain("Google Gemini");
      expect(saved.source).toBe("settings");
      expect(JSON.stringify(saved)).not.toContain("secret-key-123");
      expect(saved.saved.hasKey).toBe(true);
      expect(statSync(join(home, "model.json")).mode & 0o077).toBe(0);
      expect(((await (await call("GET", "/api/meta")).json()) as any).provider.model).toBe("model-a");

      // The agents use it right away: the request carries the key and the model, with Gemini-safe tool schemas.
      const job: any = await (await call("POST", `/api/projects/${p.id}/understand`)).json();
      let status = "running";
      for (let i = 0; i < 100 && status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        status = ((await (await call("GET", `/api/jobs/${job.id}`)).json()) as any).status;
      }
      expect(status).toBe("done");
      const chat = seen.find((s) => s.path.endsWith("/chat/completions"))!;
      expect(chat.auth).toBe("Bearer secret-key-123");
      expect(chat.body.model).toBe("model-a");
      expect(JSON.stringify(chat.body.tools)).not.toContain("additionalProperties");

      // Saving again without a key keeps the saved one.
      await call("POST", "/api/model", { preset: "gemini", baseURL: fakeUrl, model: "model-b" });
      expect(JSON.parse(readFileSync(join(home, "model.json"), "utf8"))).toMatchObject({ preset: "gemini", model: "model-b", apiKey: "secret-key-123" });

      // A model is required for providers without a default.
      expect((await call("POST", "/api/model", { preset: "openrouter" })).status).toBe(400);

      // Back to the environment (none here).
      const reset: any = await (await call("DELETE", "/api/model")).json();
      expect(reset.source).toBe("none");
      expect(reset.active).toBeNull();

      // Administrators can lock it.
      process.env.ACAI_MODEL_LOCKED = "1";
      expect((await call("POST", "/api/model", { preset: "gemini", baseURL: fakeUrl, model: "model-a" })).status).toBe(409);
      delete process.env.ACAI_MODEL_LOCKED;
    } finally {
      server.close();
    }
  });

  it("only lets administrators and approvers change where code is sent on a shared server", async () => {
    process.env.ACAI_TOKENS = "alice:alice-token-0123456789abcdef,bob:bob-token-0123456789abcdef";
    process.env.ACAI_ADMINS = "alice"; // bob is a member, not in ACAI_APPROVERS
    const projects = new Projects({ persist: false });
    projects.add(repo.dir);
    const { server, url } = await startServer({ projects, provider: null, host: "127.0.0.1", port: 0 });
    const as = (token: string) => ({ "Content-Type": "application/json", "X-Acai-Request": "1", Authorization: `Bearer ${token}` });
    const body = JSON.stringify({ preset: "ollama", baseURL: fakeUrl, model: "model-a" });
    try {
      expect((await fetch(`${url}/api/model`, { method: "POST", headers: as("bob-token-0123456789abcdef"), body })).status).toBe(403);
      expect((await fetch(`${url}/api/model/models`, { method: "POST", headers: as("bob-token-0123456789abcdef"), body })).status).toBe(403);
      expect((await fetch(`${url}/api/model`, { method: "POST", headers: as("alice-token-0123456789abcdef"), body })).status).toBe(200);
    } finally {
      delete process.env.ACAI_TOKENS;
      delete process.env.ACAI_ADMINS;
      server.close();
    }
  });
});
