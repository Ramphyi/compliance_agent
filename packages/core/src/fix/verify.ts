import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { VerificationRun } from "../types";

/** Propose build and test commands from the project's own manifests. A human approves them. */
export function detectVerifyCommands(root: string): { commands: string[]; source: string } {
  const has = (f: string) => existsSync(join(root, f));
  const read = (f: string) => {
    try {
      return readFileSync(join(root, f), "utf8");
    } catch {
      return "";
    }
  };
  if (has("assay.json")) {
    try {
      const cfg = JSON.parse(read("assay.json")) as { verify?: string[] };
      if (Array.isArray(cfg.verify) && cfg.verify.length) return { commands: cfg.verify, source: "assay.json" };
    } catch {
      /* fall through to detection */
    }
  }
  if (has("package.json")) {
    try {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      const s = pkg.scripts ?? {};
      const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
      const run = (n: string) => (pm === "npm" ? (n === "test" ? "npm test" : `npm run ${n}`) : `${pm} ${n}`);
      const cmds = ["typecheck", "lint", "build", "test"].filter((n) => s[n] && !/no test specified/.test(s[n])).map(run);
      if (cmds.length) return { commands: cmds, source: "package.json scripts" };
    } catch {
      /* fall through */
    }
  }
  if (has("Makefile") || has("makefile")) {
    const mk = read("Makefile") || read("makefile");
    const targets = ["all", "build", "check", "test"].filter((t) => new RegExp(`^${t}\\s*:`, "m").test(mk));
    if (targets.length) return { commands: targets.map((t) => `make ${t}`), source: "Makefile targets" };
  }
  if (has("CMakeLists.txt")) return { commands: ["cmake -S . -B build", "cmake --build build", "ctest --test-dir build --output-on-failure"], source: "CMakeLists.txt" };
  if (has("Cargo.toml")) return { commands: ["cargo build", "cargo test"], source: "Cargo.toml" };
  if (has("go.mod")) return { commands: ["go build ./...", "go test ./..."], source: "go.mod" };
  if (has("platformio.ini")) return { commands: ["pio run", "pio test -e native"], source: "platformio.ini" };
  if (has("gradlew")) return { commands: ["./gradlew build"], source: "Gradle wrapper" };
  if (has("pom.xml")) return { commands: ["mvn -q verify"], source: "pom.xml" };
  if (has("Package.swift")) return { commands: ["swift build", "swift test"], source: "Package.swift" };
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt") || has("tests")) {
    const pytest = /pytest/.test(read("pyproject.toml") + read("requirements.txt") + read("setup.cfg"));
    return { commands: [pytest ? "python3 -m pytest -q" : "python3 -m unittest discover -s tests"], source: "Python project" };
  }
  return { commands: [], source: "none detected" };
}

/** Environment for project commands: never pass Assay's or model providers' secrets to project code. */
function projectEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (/^(ASSAY_|ANTHROPIC_|OPENAI_|CLAUDE_)/.test(k)) delete env[k];
  env.CI = "true";
  return env;
}

export function runCommand(root: string, command: string, timeoutSec: number, signal?: AbortSignal): Promise<VerificationRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? "cmd.exe" : "/bin/sh", isWin ? ["/d", "/s", "/c", command] : ["-c", command], {
      cwd: root,
      env: projectEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWin,
    });
    let out = "";
    const keep = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > 64_000) out = out.slice(-48_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const kill = () => {
      try {
        if (!isWin && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutSec * 1000);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: code,
        passed: code === 0 && !timedOut,
        durationMs: Date.now() - started,
        output: out.slice(-12_000),
        timedOut: timedOut || undefined,
      });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ command, exitCode: null, passed: false, durationMs: Date.now() - started, output: String(e) });
    });
  });
}

/** Run commands in order and stop at the first failure. */
export async function runVerification(root: string, commands: string[], timeoutSec: number, signal?: AbortSignal) {
  const runs: VerificationRun[] = [];
  for (const c of commands) {
    const r = await runCommand(root, c, timeoutSec, signal);
    runs.push(r);
    if (!r.passed) break;
  }
  return runs;
}
