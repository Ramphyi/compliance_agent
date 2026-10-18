import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentResult, AgentRun, LlmProvider } from "../packages/core/src/llm/provider";
import { executeTool } from "../packages/core/src/llm/provider";

export const repoRoot = join(import.meta.dirname, "..");

/** Copy an example app into a fresh git repository in a temp directory. */
export function exampleRepo(app: string) {
  const dir = mkdtempSync(join(tmpdir(), `assay-${app}-`));
  cpSync(join(repoRoot, "examples/apps", app), dir, { recursive: true, filter: (p) => !p.includes("/build/") && !p.endsWith("/build") });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "initial");
  return { dir, git: (...a: string[]) => git(...a).toString(), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export type ScriptStep = { tool: string; input: unknown }[];

/**
 * A deterministic stand-in for a model: each run() consumes the next script and executes its
 * tool calls through the real tool implementations, exactly like a provider would.
 */
export class ScriptedProvider implements LlmProvider {
  readonly id = "anthropic" as const;
  readonly model = "scripted-test-model";
  readonly supportsWebSearch = true;
  readonly destination = "test";
  runs: AgentRun[] = [];
  results: { tool: string; content: string; isError: boolean }[] = [];
  constructor(private scripts: ScriptStep[][]) {}
  async run(run: AgentRun): Promise<AgentResult> {
    this.runs.push(run);
    const script = this.scripts.shift() ?? [];
    let turns = 0;
    for (const step of script) {
      turns++;
      for (const call of step) {
        const r = await executeTool(run.tools, call.tool, call.input);
        this.results.push({ tool: call.tool, content: r.content, isError: r.isError });
        run.onEvent?.({ type: "tool", name: call.tool, input: call.input, result: r.content, isError: r.isError });
      }
    }
    return { text: "", turns, usage: { inputTokens: 100, outputTokens: 50 }, stopReason: "done" };
  }
}
