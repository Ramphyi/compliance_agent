// Quick, cheap check that the configured model provider works with Acai's tool loop.
// Usage: OPENAI_API_KEY=... npx tsx scripts/provider-smoke.ts   (or ANTHROPIC_API_KEY, or ACAI_PROVIDER=openai-compatible ...)
import { z } from "zod";
import { createProvider, providerConfigFromEnv } from "../packages/core/src/index";
import { tool } from "../packages/core/src/llm/provider";

const cfg = providerConfigFromEnv();
const provider = await createProvider({ ...cfg, effort: "low" });
if (!provider) {
  console.error("No model provider configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or ACAI_PROVIDER=openai-compatible with ACAI_OPENAI_BASE_URL and ACAI_MODEL.");
  process.exit(2);
}
console.log(`provider ${cfg.provider} → ${provider.destination}`);
let answer = "";
const r = await provider.run({
  system: "You check files. Use the tools; then call finish.",
  prompt: "How many lines mention 'password' in auth.js? Call count_lines, then call finish with the number.",
  maxTurns: 5,
  finishTool: "finish",
  tools: [
    tool({ name: "count_lines", description: "Count lines matching a word in a file", schema: z.object({ file: z.string(), word: z.string() }), run: ({ file, word }) => `${file}: 3 lines contain "${word}"` }),
    tool({ name: "finish", description: "Finish with the answer", schema: z.object({ answer: z.string() }), run: ({ answer: a }) => ((answer = a), "ok") }),
  ],
  onEvent: (e) => e.type === "tool" && console.log(`  tool ${e.name} ${JSON.stringify(e.input)}`),
});
console.log(`stop=${r.stopReason} turns=${r.turns} tokens in/out=${r.usage.inputTokens}/${r.usage.outputTokens} answer=${JSON.stringify(answer)}`);
process.exit(r.stopReason === "done" && /3/.test(answer) ? 0 : 1);
