import { execFileSync } from "node:child_process";
import { lstatSync, openSync, readFileSync, readSync, closeSync, readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { ScanStats } from "../types";

export type SourceFile = {
  path: string; // posix, relative to root
  size: number;
  lang: string;
  content: string;
  lines: string[];
};

export type Snapshot = {
  stats: ScanStats;
  files: SourceFile[];
  /** Every path seen (including unread ones), for artifact detection. */
  paths: string[];
};

export const LIMITS = {
  maxEntries: 60_000,
  maxReadFiles: 12_000,
  maxFileBytes: 768 * 1024,
  maxTotalBytes: 96 * 1024 * 1024,
  maxDepth: 14,
};

const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", "vendor", "dist", "build", "out",
  "target", ".next", ".nuxt", ".svelte-kit", "coverage", ".acai", ".venv", "venv", "env",
  "__pycache__", ".mypy_cache", ".pytest_cache", ".tox", ".gradle", ".idea", "Pods",
  "DerivedData", ".dart_tool", ".pio", ".cache", ".turbo", ".terraform", "site-packages",
]);

const LANG_BY_EXT: Record<string, string> = {
  ".c": "C", ".h": "C/C++ header", ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hpp": "C++",
  ".hh": "C++", ".ino": "Arduino", ".s": "Assembly", ".asm": "Assembly",
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
  ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C", ".cs": "C#", ".rb": "Ruby",
  ".php": "PHP", ".dart": "Dart", ".scala": "Scala", ".lua": "Lua", ".sh": "Shell", ".bash": "Shell",
  ".ps1": "PowerShell", ".sql": "SQL", ".vue": "Vue", ".svelte": "Svelte", ".html": "HTML",
  ".htm": "HTML", ".css": "CSS", ".scss": "CSS", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
  ".toml": "TOML", ".ini": "INI", ".cfg": "INI", ".conf": "Config", ".xml": "XML", ".plist": "XML",
  ".arxml": "ARXML", ".dbc": "CAN DBC", ".ld": "Linker script", ".icf": "Linker script",
  ".md": "Markdown", ".rst": "Text", ".txt": "Text", ".gradle": "Gradle", ".properties": "Config",
  ".cmake": "CMake", ".mk": "Make", ".tf": "Terraform", ".proto": "Protobuf", ".graphql": "GraphQL",
  ".env": "Env", ".xcprivacy": "XML", ".entitlements": "XML", ".prisma": "Prisma", ".bat": "Batch",
};

const LANG_BY_NAME: Record<string, string> = {
  Dockerfile: "Dockerfile", Makefile: "Make", makefile: "Make", GNUmakefile: "Make",
  "CMakeLists.txt": "CMake", Jenkinsfile: "Groovy", sdkconfig: "Config", "prj.conf": "Config",
  Kconfig: "Config", Gemfile: "Ruby", Podfile: "Ruby", Procfile: "Config", ".gitignore": "Config",
  CODEOWNERS: "Config", LICENSE: "Text", NOTICE: "Text", COPYING: "Text",
};

export function languageOf(path: string): string | undefined {
  const name = path.split("/").pop()!;
  if (LANG_BY_NAME[name]) return LANG_BY_NAME[name];
  if (/^Dockerfile/.test(name)) return "Dockerfile";
  if (/^\.env/.test(name)) return "Env";
  if (/^sdkconfig/.test(name)) return "Config";
  return LANG_BY_EXT[extname(name).toLowerCase()];
}

/** Files that are never sent to a model, even redacted. Checks may still flag their presence. */
export function isSensitivePath(path: string) {
  return /(^|\/)(\.env(\.[^/]*)?|id_rsa|id_ed25519|.*\.(pem|key|p12|pfx|jks|keystore|mobileprovision)|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc)$/i.test(
    path,
  );
}

function looksBinary(buf: Buffer) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function git(root: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
}

export function gitInfo(root: string) {
  const revision = git(root, ["rev-parse", "HEAD"]);
  if (!revision) return {};
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(root, ["status", "--porcelain", "--untracked-files=normal"]);
  return { revision, branch, dirty: Boolean(status) };
}

export function scanProject(root: string): Snapshot {
  const files: SourceFile[] = [];
  const paths: string[] = [];
  let seen = 0;
  let skipped = 0;
  let bytes = 0;
  let truncated = false;

  const walk = (dir: string, depth: number) => {
    if (depth > LIMITS.maxDepth) {
      truncated = true;
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      skipped++;
      return;
    }
    for (const name of entries) {
      if (seen >= LIMITS.maxEntries) {
        truncated = true;
        return;
      }
      seen++;
      const abs = join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        skipped++;
        continue;
      }
      if (st.isSymbolicLink()) {
        skipped++;
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name) || name.endsWith(".egg-info")) {
          skipped++;
          continue;
        }
        walk(abs, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      const rel = relative(root, abs).split(sep).join("/");
      paths.push(rel);
      const lang = languageOf(rel);
      if (!lang || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|go\.sum)$/.test(rel) || /\.min\.(js|css)$/.test(rel)) {
        skipped++;
        continue;
      }
      if (st.size > LIMITS.maxFileBytes || files.length >= LIMITS.maxReadFiles || bytes + st.size > LIMITS.maxTotalBytes) {
        skipped++;
        truncated ||= files.length >= LIMITS.maxReadFiles || bytes + st.size > LIMITS.maxTotalBytes;
        continue;
      }
      let buf: Buffer;
      try {
        const fd = openSync(abs, "r");
        const head = Buffer.alloc(Math.min(st.size, 8000));
        readSync(fd, head, 0, head.length, 0);
        closeSync(fd);
        if (looksBinary(head)) {
          skipped++;
          continue;
        }
        buf = readFileSync(abs);
      } catch {
        skipped++;
        continue;
      }
      bytes += buf.length;
      const content = buf.toString("utf8");
      files.push({ path: rel, size: buf.length, lang, content, lines: content.split(/\r?\n/) });
    }
  };
  walk(root, 0);

  return {
    files,
    paths,
    stats: {
      root,
      ...gitInfo(root),
      filesSeen: seen,
      filesRead: files.length,
      bytesRead: bytes,
      skipped,
      truncated,
      scannedAt: new Date().toISOString(),
    },
  };
}

/** Redact secrets before any text leaves the machine (LLM context, reports). */
export function redactSecrets(text: string) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(
      /\b(?:sk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpors]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /((?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|client[_-]?secret|access[_-]?token|private[_-]?key)["']?\s*[=:]\s*["'`])[^"'`\n]{4,}(["'`])/gi,
      "$1[REDACTED]$2",
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, "$1[REDACTED]@");
}
