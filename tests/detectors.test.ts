import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classify, runChecks, scanProject } from "../packages/core/src/index";
import { codeOnly } from "../packages/core/src/checks/run";
import type { Snapshot } from "../packages/core/src/scan/walk";
import { repoRoot } from "./helpers";

function snap(files: Record<string, string>): Snapshot {
  const list = Object.entries(files).map(([path, content]) => ({
    path,
    size: content.length,
    lang: path.endsWith(".c") || path.endsWith(".h") ? "C" : path.endsWith(".py") ? "Python" : path.endsWith(".ts") ? "TypeScript" : "JavaScript",
    content,
    lines: content.split("\n"),
  }));
  return { files: list, paths: list.map((f) => f.path), stats: { root: "/x", filesSeen: list.length, filesRead: list.length, bytesRead: 0, skipped: 0, truncated: false, scannedAt: "" } };
}
const hits = (files: Record<string, string>) => {
  const s = snap(files);
  return runChecks(s, classify(s).classification).map((h) => h.checkId);
};

describe("detectors on the example apps", () => {
  for (const file of readdirSync(join(repoRoot, "examples/expected"))) {
    const app = file.replace(".json", "");
    it(`finds every planted, detector-findable defect in ${app}`, () => {
      const expected = (JSON.parse(readFileSync(join(repoRoot, "examples/expected", file), "utf8")) as { check: string | null; file: string }[]).filter((e) => e.check);
      const s = scanProject(join(repoRoot, "examples/apps", app));
      const found = runChecks(s, classify(s).classification);
      const keys = new Set(found.map((h) => `${h.checkId}|${h.path}`));
      const ids = new Set(found.map((h) => h.checkId));
      const missed = expected.filter((e) => !keys.has(`${e.check}|${e.file}`) && !(ids.has(e.check as never) && /missing|unsigned|unauthenticated|disclosure|headers|rate/.test(e.check!)));
      expect(missed).toEqual([]);
    });
  }
});

describe("detector precision", () => {
  it("does not treat words in log text as logged secrets", () => {
    expect(hits({ "a.js": 'console.log(`Set ANTHROPIC_API_KEY to enable ${count} checks`);\nconsole.log(`${ok ? "PASS" : "FAIL"} ${usage.outputTokens}`);' })).not.toContain("pii-in-logs");
    expect(hits({ "a.js": "console.log(`login failed for ${email} with ${password}`);" })).toContain("pii-in-logs");
  });
  it("reduces strings to their interpolations", () => {
    expect(codeOnly('log(`x ${a ? "PASS" : "b"} y`, z)').replace(/\s+/g, " ")).not.toContain("PASS");
  });
  it("does not flag 'unsigned' as signature verification for OTA", () => {
    const r = hits({ "ota.c": "#include <stdint.h>\nvoid ota_apply(unsigned long n){ hal_flash_write(0, buf, n); }\nvolatile uint32_t *reg = (uint32_t*)0x40000000;" });
    expect(r).toContain("firmware-update-unsigned");
  });
  it("ignores placeholder secrets and environment lookups", () => {
    expect(hits({ "c.js": 'const apiKey = process.env.API_KEY;\nconst password = "your-password-here";' })).not.toContain("hardcoded-secret");
    expect(hits({ "c.js": 'const api_key = "q8Zr2Lm9Xc4Vb7Nw";' })).toContain("hardcoded-secret");
  });
  it("only flags system-prompt injection when a non-constant is interpolated", () => {
    const llm = 'import Anthropic from "@anthropic-ai/sdk";\n';
    expect(hits({ "a.ts": llm + "const r = { system: BASE_PROMPT + POLICY, messages };" })).not.toContain("llm-prompt-injection-risk");
    expect(hits({ "a.ts": llm + "const r = { system: BASE_PROMPT + userNotes, messages };" })).toContain("llm-prompt-injection-risk");
  });
  it("skips test files for secrets", () => {
    expect(hits({ "test/a.test.js": 'const api_key = "q8Zr2Lm9Xc4Vb7Nw";' })).not.toContain("hardcoded-secret");
  });
});

describe("classification", () => {
  const types = (app: string) => classify(scanProject(join(repoRoot, "examples/apps", app))).classification.productTypes;
  it("recognises embedded, automotive, web and AI products", () => {
    expect(types("smart-thermostat-fw")).toEqual(expect.arrayContaining(["embedded-firmware", "iot-device"]));
    expect(types("brake-ecu")).toEqual(expect.arrayContaining(["embedded-firmware", "automotive-ecu"]));
    expect(types("telehealth-api")).toEqual(expect.arrayContaining(["backend-api", "ai-system"]));
    expect(types("credit-scoring-ml")).toEqual(expect.arrayContaining(["ai-system"]));
  });
});
