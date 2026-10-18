// Bundles the extension and copies the self-contained Assay server (dist/assay) next to it.
import { build } from "esbuild";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "../../dist/assay");
if (!existsSync(join(dist, "assay.mjs"))) {
  console.error("dist/assay/assay.mjs is missing: run `npm run build` (or `node scripts/build.mjs`) at the repository root first.");
  process.exit(1);
}

await build({
  entryPoints: [join(here, "src/extension.ts")],
  outfile: join(here, "out/extension.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "warning",
});

rmSync(join(here, "server"), { recursive: true, force: true });
cpSync(dist, join(here, "server"), { recursive: true });
if (!existsSync(join(here, "server/dashboard/index.html"))) console.warn("warning: the dashboard is not built; the dashboard panel will show a placeholder");
console.log("extension built: out/extension.js + server/");
