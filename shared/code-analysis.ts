export type SourceFile = { path: string; content: string };
export type CodeReference = { path: string; line: number; excerpt: string };
export type AnswerSuggestion = {
  answer: string;
  confidence: "observed" | "inferred" | "unknown";
  references: CodeReference[];
};
export type CodeAnalysis = {
  summary: string;
  mode: "static" | "ai";
  filesRead: number;
  bytesRead: number;
  totalFiles: number;
  excludedFiles: number;
  limitedFiles: number;
  revision?: string;
  scannedAt: string;
  technologyHints: string[];
  modules: { name: string; files: number }[];
  signals: { kind: string; description: string; references: CodeReference[] }[];
  suggestions: Record<string, AnswerSuggestion>;
  warnings: string[];
  files: { path: string; lines: number }[];
};
export const SCAN_MAX_BYTES = 6_000_000;
export const SCAN_FILE_BYTES = 180_000;
export const SCAN_MAX_FILES = 3000;
export function eligibleSource(path: string) {
  if (
    path.length > 300 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => [".", "..", ""].includes(p))
  )
    return false;
  if (
    /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.aws|\.ssh|\.local|vendor|\.venv|venv|target|secrets|credentials|uploads|data)(\/|$)|(^|\/)(\.env[^/]*|[^/]*(?:secret|credential)[^/]*)(\/|$)|\.(pem|key|p12|pfx|lock|map|min\.js|sqlite|db)$/i.test(
      path,
    )
  )
    return false;
  if (/package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/i.test(path))
    return false;
  return (
    /\.(tsx?|jsx?|mjs|cjs|py|go|java|cs|rs|rb|php|c|cpp|h|sql|prisma|graphql|md|txt|json|ya?ml|toml|xml|swift|kt|vue|svelte|html|css|sh|ps1)$/i.test(
      path,
    ) ||
    /(^|\/)(Dockerfile[^/]*|LICENSE|COPYING|NOTICE|go.mod|Gemfile)$/i.test(path)
  );
}
export function redactSecrets(text: string) {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /((?:password|passwd|api[_-]?key|auth[_-]?token|client[_-]?secret|access[_-]?token)["']?\s*[=:]\s*["'`])[^"'`\n]{4,}(["'`])/gi,
      "$1[REDACTED]$2",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@");
}
export function analyzeSource(
  files: SourceFile[],
  coverage: {
    totalFiles: number;
    excludedFiles: number;
    limitedFiles: number;
    revision?: string;
  },
): CodeAnalysis {
  const signals: CodeAnalysis["signals"] = [];
  const hints = new Set<string>();
  const matches = (pattern: RegExp, max = 8): CodeReference[] => {
    const refs: CodeReference[] = [];
    for (const file of files) {
      const lines = file.content.split("\n");
      for (let i = 0; i < lines.length && refs.length < max; i++)
        if (pattern.test(lines[i]))
          refs.push({
            path: file.path,
            line: i + 1,
            excerpt: redactSecrets(lines[i].trim()).slice(0, 220),
          });
      if (refs.length >= max) break;
    }
    return refs;
  };
  for (const f of files.filter((f) => /package\.json$/.test(f.path))) {
    try {
      const p = JSON.parse(f.content);
      for (const d of Object.keys({ ...p.dependencies, ...p.devDependencies }))
        if (
          /^(react|next|vue|express|fastify|openai|@anthropic-ai\/sdk|@modelcontextprotocol\/sdk|pg|prisma|better-sqlite3|vite)$/.test(
            d,
          )
        )
          hints.add(d);
    } catch {
      /* Invalid manifests remain in coverage; no scripts are executed. */
    }
  }
  if (files.some((f) => f.path.endsWith(".go"))) hints.add("Go");
  if (files.some((f) => f.path.endsWith(".py"))) hints.add("Python");
  const runtime = files.filter(
    (f) =>
      /\.(tsx?|jsx?|mjs|cjs|py|go|java|cs|rs|rb|php|c|cpp|h|sql|prisma|swift|kt|vue|svelte)$/i.test(
        f.path,
      ) && !/(^|\/)(tests?|docs?|work)\/|\.(test|spec)\./i.test(f.path),
  );
  const implementation = (regex: RegExp) => {
    const refs: CodeReference[] = [];
    for (const file of runtime)
      for (const [i, line] of file.content.split("\n").entries())
        if (regex.test(line) && refs.length < 8)
          refs.push({
            path: file.path,
            line: i + 1,
            excerpt: redactSecrets(line.trim()).slice(0, 220),
          });
    return refs;
  };
  const personal = implementation(
    /\b(email|phone|dateOfBirth|full_name|first_name|address|user_id|owner_id)\b/i,
  );
  const storage = implementation(
    /sqlite|postgres|mongodb|s3\b|localStorage|prisma|DATABASE_URL/i,
  );
  const access = implementation(
    /owner_id\s*=|user_id\s*=|requireAuth|authorize|hasPermission|canAccess|tenant_id|permissionDenied|forbidden|status\(403\)/i,
  );
  const ai = implementation(
    /openai|anthropic|ollama|chat\.completions|responses\.create/i,
  );
  const license = matches(
    /license.{0,70}(block|non.compliant|only|policy|restrict)|release.{0,45}blocked|GPL|AGPL/i,
  );
  const add = (
    kind: string,
    description: string,
    references: CodeReference[],
  ) => {
    if (references.length) signals.push({ kind, description, references });
  };
  add(
    "data",
    "Personal-data fields appear in implementation files. This is not an exhaustive data-flow trace.",
    personal,
  );
  add(
    "storage",
    "Storage or persistence references found; deployment location and retention still need confirmation.",
    storage,
  );
  add(
    "access",
    "Authorization and ownership checks are present. Their correctness and route coverage require tests.",
    access,
  );
  add(
    "ai",
    "AI provider or inference code is present; confirm which features are enabled.",
    ai,
  );
  add(
    "license",
    "Licensing or release-policy text needs review against the actual distributed artifact.",
    license,
  );
  const readme =
    files.find((f) => /^readme\.md$/i.test(f.path)) ||
    files.find((f) => /readme\.md$/i.test(f.path));
  const purposeRefs: CodeReference[] = [];
  if (readme) {
    const lines = readme.content.split("\n");
    const candidates = lines
      .map((text, index) => ({ text: text.trim(), line: index + 1 }))
      .filter((v) => v.text.length > 65 && !/^[#|>`]/.test(v.text));
    const description = (text: string) =>
      /workspace|platform|application|service|software|tool|suite|editor/i.test(
        text,
      ) &&
      !/docker|npm |blocked|license|non.compliant|https?:|^See |^The guide|^Use |chapters|checklists/i.test(
        text,
      );
    const descriptionScore = (text: string) =>
      description(text)
        ? 1 +
          (/^An? /i.test(text) ? 3 : 0) +
          (/^[\w .-]+ is an? /i.test(text) ? 2 : 0)
        : 0;
    candidates.sort(
      (a, b) =>
        descriptionScore(b.text) - descriptionScore(a.text) || a.line - b.line,
    );
    for (const candidate of candidates.slice(0, 3)) {
      const excerpt = redactSecrets(candidate.text);
      purposeRefs.push({
        path: readme.path,
        line: candidate.line,
        excerpt: excerpt.length > 450 ? excerpt.slice(0, 447) + "…" : excerpt,
      });
    }
  }
  const suggestions: CodeAnalysis["suggestions"] = {
    purpose: {
      answer: purposeRefs.length
        ? `Repository documentation describes: ${purposeRefs.map((r) => r.excerpt).join(" ")}\nConfirm the intended customer and deployed features.`
        : "The repository does not establish a clear product description. Confirm its purpose and intended users.",
      confidence: purposeRefs.length ? "inferred" : "unknown",
      references: purposeRefs,
    },
    markets: {
      answer:
        "Target countries and intended customers cannot be reliably established from source code. Confirm the countries where this deployment will be offered and whether users are businesses, consumers or children.",
      confidence: "unknown",
      references: [],
    },
    data: {
      answer: personal.length
        ? `Personal-data references were found in ${[...new Set(personal.map((r) => r.path))].join(", ")}. ${storage.length ? `Storage references occur in ${[...new Set(storage.map((r) => r.path))].join(", ")}.` : "No recognized storage provider was established."} Confirm the exact data categories, processors, hosting regions and retention periods.`
        : "No recognized personal-data fields were found in the scanned implementation. This does not prove that the product collects no personal data; confirm the actual data flows.",
      confidence: personal.length ? "inferred" : "unknown",
      references: [...personal.slice(0, 4), ...storage.slice(0, 4)],
    },
    access: {
      answer: access.length
        ? `Authorization or ownership checks appear in ${[...new Set(access.map((r) => r.path))].join(", ")}. These are implementation signals, not proof that every route is protected. Verify cross-user and cross-tenant access tests before accepting this control.`
        : "No recognized ownership or authorization checks were found in the scanned implementation. Inspect the access-control design and cross-user tests before release.",
      confidence: access.length ? "inferred" : "unknown",
      references: access,
    },
    ai: {
      answer: ai.length
        ? `AI-related code appears in ${[...new Set(ai.map((r) => r.path))].join(", ")}. Confirm which providers and features run in production, what data they receive, and how outputs are reviewed.`
        : "No recognized AI integration was found. Confirm whether AI is provided by an external component or service.",
      confidence: ai.length ? "inferred" : "unknown",
      references: ai,
    },
  };
  const modules = new Map<string, number>();
  for (const file of files) {
    const name = file.path.includes("/") ? file.path.split("/")[0] : "(root)";
    modules.set(name, (modules.get(name) || 0) + 1);
  }
  return {
    summary:
      purposeRefs[0]?.excerpt ||
      "Source scan completed. Confirm the product description and deployment context.",
    mode: "static",
    filesRead: files.length,
    bytesRead: files.reduce(
      (n, f) => n + new TextEncoder().encode(f.content).length,
      0,
    ),
    ...coverage,
    scannedAt: new Date().toISOString(),
    technologyHints: [...hints],
    modules: [...modules].map(([name, files]) => ({ name, files })),
    signals,
    suggestions,
    warnings: [
      "Static source analysis identifies review leads; it does not execute code or prove control correctness.",
      "Business audience, deployment countries and data retention need owner confirmation.",
      ...(coverage.limitedFiles
        ? [
            `${coverage.limitedFiles} files were outside the size or analysis limits.`,
          ]
        : []),
    ],
    files: files.map((f) => ({
      path: f.path,
      lines: f.content.split("\n").length,
    })),
  };
}
