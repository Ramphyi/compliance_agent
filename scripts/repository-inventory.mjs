import { readdir, readFile, lstat, realpath } from "node:fs/promises";
import { resolve, relative, basename, sep, isAbsolute } from "node:path";

// Read-only, bounded metadata collection. Target code and scripts are never executed.
export async function inspectRepository(directory) {
  const root = await realpath(resolve(directory));
  if (!(await lstat(root)).isDirectory()) throw new Error("Directory required");
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
    "vendor",
    ".venv",
    "venv",
    "target",
    "secrets",
    "credentials",
  ]);
  const files = [],
    warnings = [],
    manifests = [],
    hints = new Set();
  let depthTruncated = false,
    entryTruncated = false,
    entriesSeen = 0,
    linksSkipped = 0;
  const maxFiles = 5000,
    maxEntries = 10000,
    depthLimit = 5,
    manifestLimit = 32;
  const within = (path) => {
    const rel = relative(root, path);
    return (
      rel !== "" &&
      !rel.startsWith(".." + sep) &&
      rel !== ".." &&
      !isAbsolute(rel)
    );
  };
  async function walk(dir, depth = 0) {
    if (depth > depthLimit) {
      depthTruncated = true;
      return;
    }
    let entries;
    try {
      entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name, "en"),
      );
    } catch {
      warnings.push("An inaccessible directory was skipped.");
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles || entriesSeen >= maxEntries) {
        entryTruncated = true;
        return;
      }
      entriesSeen++;
      const name = entry.name.toLowerCase();
      if (
        skip.has(name) ||
        name.startsWith(".env") ||
        /\.(pem|key|p12|pfx)$/.test(name)
      )
        continue;
      if (entry.isSymbolicLink()) {
        linksSkipped++;
        continue;
      }
      const path = resolve(dir, entry.name);
      if (!within(path)) continue;
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile())
        files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await walk(root);
  const candidates = files.filter((f) =>
    ["package.json", "go.mod"].includes(basename(f)),
  );
  for (const file of candidates.slice(0, manifestLimit)) {
    const path = resolve(root, file);
    try {
      const stat = await lstat(path);
      if (
        stat.isSymbolicLink() ||
        stat.size > 500000 ||
        !within(await realpath(path))
      ) {
        warnings.push("A manifest was skipped by the read boundary.");
        continue;
      }
      const content = await readFile(path, "utf8");
      if (file.endsWith("package.json")) {
        const pkg = JSON.parse(content);
        const deps = Object.keys({
          ...pkg.dependencies,
          ...pkg.devDependencies,
        });
        const selected = deps.filter((d) =>
          [
            "react",
            "next",
            "vue",
            "svelte",
            "express",
            "fastify",
            "openai",
            "@anthropic-ai/sdk",
            "@modelcontextprotocol/sdk",
            "pg",
            "prisma",
            "helmet",
            "vite",
          ].includes(d),
        );
        selected.forEach((d) => hints.add(d));
        manifests.push({
          path: file,
          ecosystem: "JavaScript",
          technologyHints: selected.sort(),
        });
      } else {
        const selected = ["Go"];
        if (/github\.com\/openai\/openai-go(?:\s|\/)/.test(content))
          selected.push("openai-go");
        if (/github\.com\/modelcontextprotocol\/go-sdk/.test(content))
          selected.push("mcp-go-sdk");
        if (/github\.com\/lib\/pq/.test(content))
          selected.push("PostgreSQL Go driver");
        selected.forEach((d) => hints.add(d));
        manifests.push({
          path: file,
          ecosystem: "Go",
          technologyHints: selected.sort(),
        });
      }
    } catch {
      warnings.push("An unreadable or invalid manifest was skipped.");
    }
  }
  return {
    type: "local_repository_inventory",
    generatedAt: new Date().toISOString(),
    filesInspected: files.length,
    truncated:
      depthTruncated || entryTruncated || candidates.length > manifestLimit,
    depthLimit,
    manifestLimit,
    depthTruncated,
    entryTruncated,
    linksSkipped,
    technologyHints: [...hints].sort(),
    manifests,
    warnings: [...new Set(warnings)],
    artifacts: {
      privacy: files.filter((f) => /privacy/i.test(f)),
      security: files.filter((f) => /(security|threat[._-]?model)/i.test(f)),
      licenses: files.filter((f) =>
        /(^|\/)(licen[cs]e|copying|notice)(\.[^/]*)?$/i.test(f),
      ),
      tests: files.filter((f) =>
        /([._](test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$|_test\.py$)/i.test(
          f,
        ),
      ),
      pipelines: files.filter(
        (f) =>
          f.startsWith(".github/workflows/") ||
          /gitlab-ci|bitbucket-pipelines|Jenkinsfile/.test(f),
      ),
      mobile: files.filter((f) => /AndroidManifest\.xml$|Info\.plist$/.test(f)),
      embedded: files.filter((f) =>
        /platformio\.ini$|CMakeLists\.txt$/.test(f),
      ),
    },
    limits: [
      "File presence is not implementation evidence. Tests were discovered, not executed.",
      "No source contents, secrets or full dependency versions are included.",
      "Review before submitting as evidence. This report cannot approve a control.",
      "Traversal stops at 5 directory levels, 5000 files or 10000 entries. At most 32 manifests of 500000 bytes are read.",
    ],
  };
}
