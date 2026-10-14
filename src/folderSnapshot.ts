import type { CodeSnapshot } from "../shared/discovery";

// Only explicitly selected folder metadata and small manifests are read in the browser.
// Raw source files are never uploaded.
export async function folderSnapshot(list: FileList): Promise<CodeSnapshot> {
  const skipped =
    /(^|\/)(node_modules|\.git|\.env[^/]*|dist|build|coverage|\.next|\.aws|\.ssh|\.local|vendor|\.venv|venv|target|secrets|credentials)(\/|$)|\.(pem|key|p12|pfx)$/i;
  const files = Array.from(list)
    .map((file) => ({
      file,
      path:
        (file.webkitRelativePath || file.name).split("/").slice(1).join("/") ||
        file.name,
    }))
    .filter((item) => !skipped.test(item.path));
  if (!files.length)
    throw new Error(
      "No eligible project files were found. Choose your project folder.",
    );
  const bounded = files
    .filter((item) => item.path.split("/").length <= 6)
    .slice(0, 5000);
  const hints = new Set<string>();
  const manifests = bounded.filter((item) =>
    /(^|\/)(package.json|go.mod)$/.test(item.path),
  );
  let incomplete = bounded.length < files.length || manifests.length > 32;
  for (const { file, path } of manifests.slice(0, 32)) {
    if (file.size > 500000) {
      incomplete = true;
      continue;
    }
    try {
      const text = await file.text();
      if (path.endsWith("package.json")) {
        const pkg = JSON.parse(text);
        Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
          .filter((d) =>
            [
              "react",
              "next",
              "vue",
              "express",
              "openai",
              "@anthropic-ai/sdk",
              "@modelcontextprotocol/sdk",
              "pg",
              "prisma",
              "vite",
            ].includes(d),
          )
          .forEach((d) => hints.add(d));
      } else {
        hints.add("Go");
        if (/github\.com\/openai\/openai-go/.test(text)) hints.add("openai-go");
      }
    } catch {
      incomplete = true;
    }
  }
  const paths = bounded.map((item) => item.path);
  const select = (pattern: RegExp) => {
    const matched = paths.filter((path) => pattern.test(path));
    if (matched.length > 30) incomplete = true;
    return matched.slice(0, 30).map((path) => path.slice(0, 300));
  };
  const artifacts = {
    privacy: select(/privacy/i),
    security: select(/security|threat[._-]?model/i),
    licenses: select(/(^|\/)(license|licence|copying|notice)(\.[^/]*)?$/i),
    tests: select(
      /[._](test|spec)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]+\.py$/i,
    ),
    pipelines: select(
      /(^|\/)\.github\/workflows\/|gitlab-ci|bitbucket-pipelines|Jenkinsfile/,
    ),
    mobile: select(/AndroidManifest\.xml$|Info\.plist$/),
    embedded: select(/platformio\.ini$|CMakeLists\.txt$/),
  };
  return {
    filesInspected: bounded.length,
    technologyHints: [...hints].sort(),
    artifacts,
    generatedAt: new Date().toISOString(),
    truncated: incomplete,
  };
}
