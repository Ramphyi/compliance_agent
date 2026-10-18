// Measures detector recall against the planted-defect answer keys in examples/expected.
// Usage: npm run eval:detectors  (exit 1 if recall drops below the threshold)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classify, runChecks, scanProject } from "../packages/core/src/index";

type Expected = { check: string | null; file: string; line: number; issue: string };

const root = join(import.meta.dirname, "..", "examples");
const threshold = Number(process.env.MIN_RECALL ?? 0.8);
let found = 0;
let total = 0;
const rows: string[] = [];

for (const file of readdirSync(join(root, "expected")).filter((f) => f.endsWith(".json"))) {
  const app = file.replace(/\.json$/, "");
  const expected = (JSON.parse(readFileSync(join(root, "expected", file), "utf8")) as Expected[]).filter((e) => e.check);
  const snapshot = scanProject(join(root, "apps", app));
  const { classification } = classify(snapshot);
  const hits = runChecks(snapshot, classification);
  const seen = new Set(hits.map((h) => `${h.checkId}|${h.path}`));
  const byCheck = new Set(hits.map((h) => h.checkId));
  let appFound = 0;
  for (const e of expected) {
    // A repo-level detector anchors at one file; count it when the check fired anywhere.
    const ok = seen.has(`${e.check}|${e.file}`) || (byCheck.has(e.check as never) && /missing|unsigned|unauthenticated|disclosure|headers|rate/.test(e.check!));
    if (ok) appFound++;
    else rows.push(`  MISS ${app}: ${e.check} @ ${e.file}:${e.line} (${e.issue.slice(0, 90)})`);
  }
  found += appFound;
  total += expected.length;
  console.log(`${app}: ${appFound}/${expected.length} detector-findable defects found`);
}
console.log(rows.join("\n"));
const recall = total ? found / total : 1;
console.log(`\nRecall ${(recall * 100).toFixed(0)}% (${found}/${total}); threshold ${(threshold * 100).toFixed(0)}%`);
process.exit(recall >= threshold ? 0 : 1);
