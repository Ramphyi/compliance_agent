// Builds the self-contained distribution used by Docker, `npx`, and the VS Code extension:
//   dist/assay/assay.mjs      CLI + server + MCP (all dependencies bundled)
//   dist/assay/registry/      rule registry
//   dist/assay/dashboard/     built dashboard (if packages/dashboard/dist exists)
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "assay");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "packages/cli/src/main.ts")],
  outfile: join(out, "assay.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  legalComments: "external",
  // Some bundled dependencies are CommonJS and expect require/__dirname.
  banner: {
    js: [
      "import { createRequire as __assayRequire } from 'node:module';",
      "import { fileURLToPath as __assayUrl } from 'node:url';",
      "import { dirname as __assayDir } from 'node:path';",
      "const require = __assayRequire(import.meta.url);",
      "const __filename = __assayUrl(import.meta.url);",
      "const __dirname = __assayDir(__filename);",
    ].join("\n"),
  },
  logLevel: "warning",
});

cpSync(join(root, "registry"), join(out, "registry"), { recursive: true });
const dash = join(root, "packages/dashboard/dist");
if (existsSync(join(dash, "index.html"))) cpSync(dash, join(out, "dashboard"), { recursive: true });
else console.warn("dashboard not built; run `npm run build -w @assay/dashboard` first");
cpSync(join(root, "skills"), join(out, "skills"), { recursive: true });
writeFileSync(
  join(out, "package.json"),
  JSON.stringify({ name: "assay", version: "0.1.0", type: "module", bin: { assay: "./assay.mjs" }, engines: { node: ">=22.12" } }, null, 2),
);
console.log(`built ${out}`);
