// Validates registry/ (questionnaire, frameworks, presets). Exit code 1 on errors.
// Usage: npm run registry:validate [-- --warnings] [-- <registry dir>]
import { resolve } from "node:path";
import { loadRegistry } from "../packages/core/src/registry/load";

const args = process.argv.slice(2);
const showWarnings = args.includes("--warnings");
const dir = args.find((a) => !a.startsWith("--"));
const { registry, errors, warnings } = loadRegistry(
  dir ? resolve(dir) : undefined,
);

for (const e of errors) console.error(`ERROR ${e.file}: ${e.message}`);
if (showWarnings) for (const w of warnings) console.warn(`WARN  ${w.file}: ${w.message}`);

const byKind = new Map<string, number>();
for (const f of registry.frameworks) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
console.log(
  `${registry.frameworks.length} frameworks, ${registry.controls.size} controls, ` +
    `${registry.presets.length} presets, ${errors.length} errors, ${warnings.length} crosswalk warnings` +
    (showWarnings ? "" : " (--warnings to list)"),
);
console.log(
  [...byKind].map(([k, n]) => `${k}: ${n}`).join(", ") || "no frameworks yet",
);
process.exit(errors.length ? 1 : 0);
