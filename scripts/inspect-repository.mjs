import { readdir, readFile, lstat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
// Local, read-only metadata collection. Never executes code or reads .env files.
const root = resolve(process.argv[2] || ".");
const skip = new Set([
  "node_modules",
  ".git",
  ".env",
  "dist",
  "build",
  "coverage",
  ".next",
  ".aws",
  ".ssh",
  ".local",
]);
const files = [];
async function walk(dir, depth = 0) {
  if (depth > 5 || files.length >= 5000) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      skip.has(entry.name) ||
      entry.name.startsWith(".env") ||
      entry.isSymbolicLink()
    )
      continue;
    const path = resolve(dir, entry.name);
    if (!path.startsWith(root + sep)) continue;
    if (entry.isDirectory()) await walk(path, depth + 1);
    else if (entry.isFile())
      files.push(relative(root, path).replaceAll("\\", "/"));
    if (files.length >= 5000) break;
  }
}
await walk(root);
let dependencies = [];
try {
  const manifest = resolve(root, "package.json");
  const stat = await lstat(manifest);
  if (!stat.isSymbolicLink() && stat.size < 500000) {
    const pkg = JSON.parse(await readFile(manifest, "utf8"));
    dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  }
} catch {}
const report = {
  type: "local_repository_inventory",
  generatedAt: new Date().toISOString(),
  filesInspected: files.length,
  truncated: files.length >= 5000,
  depthLimit: 5,
  technologyHints: dependencies.filter((d) =>
    [
      "react",
      "next",
      "express",
      "fastify",
      "openai",
      "@modelcontextprotocol/sdk",
      "pg",
      "prisma",
      "helmet",
    ].includes(d),
  ),
  artifacts: {
    privacy: files.filter((f) => /privacy/i.test(f)),
    security: files.filter((f) => /(security|threat.model)/i.test(f)),
    tests: files.filter((f) => /(test|spec)\.(ts|js|tsx|py)$/.test(f)),
    pipelines: files.filter(
      (f) =>
        f.startsWith(".github/workflows/") || /gitlab-ci|Jenkinsfile/.test(f),
    ),
    mobile: files.filter((f) => /AndroidManifest.xml|Info.plist/.test(f)),
    embedded: files.filter((f) => /platformio.ini|CMakeLists.txt/.test(f)),
  },
  limits: [
    "File presence is not implementation evidence. Tests were discovered, not executed.",
    "No source contents, secrets or full dependency versions are included.",
    "Review this report before submitting it as evidence. It cannot approve a control.",
  ],
};
console.log(JSON.stringify(report, null, 2));
