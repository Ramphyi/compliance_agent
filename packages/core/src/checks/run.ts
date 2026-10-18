import type { Classification, CheckId, CodeRef } from "../types";
import { redactSecrets, type Snapshot, type SourceFile } from "../scan/walk";
import { LINE_CHECKS, type LineCheck } from "./rules";

export type CheckHit = { checkId: CheckId; path: string; refs: CodeRef[] };

export const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|testdata|test_data|fixtures?|mocks?|__mocks__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(go|py|c|cpp|rs)$|Tests?\.(java|kt|swift|cs)$/i;

const HASH_COMMENT = /^(Python|Shell|YAML|TOML|INI|Config|Env|Dockerfile|Make|CMake|Ruby|Properties|Terraform|Text|PowerShell)$/;

function isComment(line: string, lang: string) {
  const t = line.trimStart();
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("* ") || t === "*" || t.startsWith("<!--")) return true;
  if (HASH_COMMENT.test(lang) && t.startsWith("#")) return true;
  if (lang === "SQL" && t.startsWith("--")) return true;
  return false;
}

const MAX_REFS_PER_FILE = 8;

function ref(f: SourceFile, i: number): CodeRef {
  return { path: f.path, line: i + 1, excerpt: redactSecrets(f.lines[i].trim()).slice(0, 220) };
}

/** Reduce string literals to their interpolated expressions, so "password: ${pw}" keeps only "pw". */
export function codeOnly(line: string, depth = 0): string {
  const out = line.replace(/(["'`])((?:\\.|(?!\1).)*)\1/g, (_m, _q, body: string) => {
    const parts = [...body.matchAll(/\$\{([^}]*)\}|\{([A-Za-z_][\w.]*)\}/g)].map((x) => x[1] ?? x[2]);
    return parts.length ? ` ${parts.join(" ")} ` : " ";
  });
  // Interpolations can contain string literals of their own ("${ok ? "PASS" : "FAIL"}").
  return depth < 2 && /["'`]/.test(out) ? codeOnly(out, depth + 1) : out;
}

function windowMatches(f: SourceFile, i: number, re: RegExp, w: number) {
  for (let j = Math.max(0, i - w); j <= Math.min(f.lines.length - 1, i + w); j++)
    if (re.test(f.lines[j])) return true;
  return false;
}

export type ProjectFlags = { embedded: boolean; llm: boolean };

export function projectFlags(c: Classification): ProjectFlags {
  const ids = new Set(c.signals.map((s) => s.id));
  const types = new Set(c.productTypes);
  return {
    embedded:
      ids.has("embedded-c") || ids.has("rtos") || ids.has("linker-script") || ids.has("autosar") ||
      ["embedded-firmware", "iot-device", "automotive-ecu", "industrial-control"].some((t) => types.has(t)),
    llm: ids.has("llm"),
  };
}

function runLineCheck(check: LineCheck, files: SourceFile[], flags: ProjectFlags): CheckHit[] {
  if (check.projectGate && !flags[check.projectGate]) return [];
  const hits: CheckHit[] = [];
  for (const f of files) {
    if (!check.langs.test(f.lang)) continue;
    if (check.paths && !check.paths.test(f.path)) continue;
    if (check.excludePaths?.test(f.path)) continue;
    if (!check.includeTests && TEST_PATH.test(f.path)) continue;
    if (check.fileGate && !check.fileGate.test(f.content)) continue;
    const refs: CodeRef[] = [];
    for (let i = 0; i < f.lines.length && refs.length < MAX_REFS_PER_FILE; i++) {
      const line = f.lines[i];
      if (line.length > 2000) continue;
      if (!check.pattern.test(line)) continue;
      if (!check.allowComments && isComment(line, f.lang)) continue;
      if (check.exclude?.test(line)) continue;
      const w = check.window ?? 0;
      if (check.near) {
        const near = check.near;
        const test = (t: string) => near.test(check.nearInCode ? codeOnly(t) : t);
        let ok = w === 0 ? test(line) : windowMatches(f, i, near, w);
        if (!ok && check.continuation && /[+(:]\s*$/.test(line) && i + 1 < f.lines.length) ok = test(f.lines[i + 1]);
        if (!ok) continue;
      }
      if (check.notNear && windowMatches(f, i, check.notNear, w)) continue;
      refs.push(ref(f, i));
    }
    if (refs.length) hits.push({ checkId: check.id, path: f.path, refs });
  }
  return hits;
}

function grepRefs(files: SourceFile[], re: RegExp, filter: (f: SourceFile) => boolean, max = 5, skipComments = false) {
  const refs: CodeRef[] = [];
  for (const f of files) {
    if (!filter(f)) continue;
    for (let i = 0; i < f.lines.length && refs.length < max; i++)
      if (re.test(f.lines[i]) && !(skipComments && isComment(f.lines[i], f.lang))) refs.push(ref(f, i));
    if (refs.length >= max) break;
  }
  return refs;
}

const CODE_LANG = /^(C|C\+\+|C\/C\+\+ header|Arduino|JavaScript|TypeScript|Python|Go|Rust|Java|Kotlin|Swift|Objective-C|C#|Ruby|PHP|Dart|Vue|Svelte)$/;
const notTest = (f: SourceFile) => !TEST_PATH.test(f.path);
const code = (f: SourceFile) => CODE_LANG.test(f.lang) && notTest(f);
const C_LANG = (f: SourceFile) => /^(C|C\+\+|C\/C\+\+ header|Arduino)$/.test(f.lang) && notTest(f);

function repoChecks(s: Snapshot, c: Classification, flags: ProjectFlags): CheckHit[] {
  const hits: CheckHit[] = [];
  const signal = (id: string) => c.signals.find((x) => x.id === id);
  const add = (checkId: CheckId, refs: CodeRef[]) => {
    if (!refs.length) return;
    const byPath = new Map<string, CodeRef[]>();
    for (const r of refs) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r]);
    // Repo-level findings are one finding anchored at the first location.
    hits.push({ checkId, path: refs[0].path, refs: refs.slice(0, MAX_REFS_PER_FILE) });
  };

  for (const f of s.files.filter((x) => x.lang === "Dockerfile")) {
    const users = f.lines.map((l, i) => [l, i] as const).filter(([l]) => /^\s*USER\s+/i.test(l));
    const last = users.at(-1);
    if (!last) add("docker-root-user", [ref(f, Math.max(0, f.lines.findIndex((l) => /^\s*FROM\b/i.test(l))))]);
    else if (/^\s*USER\s+(root|0)(\s|:|$)/i.test(last[0])) add("docker-root-user", [ref(f, last[1])]);
  }

  const reflash = signal("uds") && s.files.some((f) => C_LANG(f) && f.lines.some((l) => /RequestDownload|TransferData|REQUEST_DOWNLOAD|TRANSFER_DATA/.test(l)));
  if (signal("ota") || reflash) {
    const verified = grepRefs(s.files, /\bsignature|\bsigned\b|\bverify\w*\(|ecdsa|ed25519|rsa_?verify|mbedtls_pk_verify|esp_secure_boot|image_validate|bootutil_img_validate|esp_image_verify|uptane|sha256.*(compare|cmp|match)/i, code, 1);
    if (!verified.length) add("firmware-update-unsigned", grepRefs(s.files, /esp_https_ota|esp_ota_(begin|write|set_boot)|ota_(begin|write|update|start|download|apply)\w*|flash_(write|program)\w*|fw_?update\w*|firmware_?update\w*|dfu_\w+|RequestDownload|TransferData/i, code));
  }

  const can = signal("can-bus");
  if (can) {
    // Protection must live where CAN frames are handled, not anywhere in the code base.
    const CAN_IO = /can_frame|CAN_(Receive|Transmit|Rx|Tx)\w*|HAL_(FD)?CAN_\w+|twai_(receive|transmit)|can_(rx|tx|recv|send|receive|transmit|msg|frame)\w*|CanIf_\w+|Com_ReceiveSignal|on_can_\w+|\bRx\w*Handler\b|CAN_ID_\w+/i;
    const canFiles = new Set(s.files.filter((f) => C_LANG(f) && f.lines.some((l) => CAN_IO.test(l))).map((f) => f.path));
    const protectedRefs = grepRefs(s.files, /SecOC|CMAC|\bmac_?(verify|check|calc)|freshness|E2E_P\d+|E2E_\w*(Check|Protect)|\bcrc8?_?(check|calc|verify)\w*\s*\(|alive_?counter|rolling_?counter|message_?counter/i, (f) => canFiles.has(f.path), 1, true);
    if (!protectedRefs.length) add("can-unauthenticated", grepRefs(s.files, CAN_IO, (f) => canFiles.has(f.path) && !/(^|\/)include\//.test(f.path), 5, true));
  }

  if (flags.embedded) {
    const wd = grepRefs(s.files, /watchdog|\bwdt\b|wdt_|iwdg|wwdg|esp_task_wdt|WdgM_|\bwdog|HAL_IWDG|k_wdt|task_wdt/i, code, 1);
    if (!wd.length) add("missing-watchdog", grepRefs(s.files, /while\s*\(\s*(1|true|TRUE)\s*\)|for\s*\(\s*;\s*;\s*\)|vTaskStartScheduler|\bmain\s*\(|\w+_(cyclic|task|loop|main)\w*\s*\(\s*void\s*\)/, C_LANG, 3));
  }

  const web = signal("web-server");
  if (web) {
    const headers = grepRefs(s.files, /helmet|Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|frame-ancestors|SecurityMiddleware|talisman|secure_headers|X-Content-Type-Options/i, (f) => notTest(f), 1);
    if (!headers.length) add("missing-security-headers", web.refs.slice(0, 3));
    const authRoutes = grepRefs(s.files, /["'`](\/api)?(\/v\d)?(\/auth)?\/(login|signin|sign-in|token|sessions?|password|reset-password|otp)\b|===?\s*["'](login|signin|sign-in|authenticate|otp)["']/i, code);
    if (authRoutes.length) {
      const limited = grepRefs(s.files, /rate.?limit|ratelimit|slowapi|throttl|limiter|too many (requests|attempts)|\b429\b|lockout|failed_?(login_?)?attempts|max_?attempts/i, code, 1);
      if (!limited.length) add("missing-rate-limiting", authRoutes);
    }
  }

  const llm = signal("llm");
  const ui = signal("frontend") || signal("web-server") || signal("android") || signal("ios") || signal("cross-platform-mobile");
  if (llm && ui) {
    const disclosure = grepRefs(
      s.files,
      /\bAI[- ](generated|assistant|system|powered|model|chat)|artificial intelligence|(talking|chatting|interacting|speaking) (to|with) an? (AI|bot|virtual assistant|automated)|powered by (AI|GPT|Claude|an AI)|this is an AI|automated assistant|not a (human|doctor)|asistent (AI|virtual)|inteligen[țt][ăa] artificial[ăa]/i,
      (f) => /^(HTML|JavaScript|TypeScript|Vue|Svelte|Swift|Kotlin|Java|Dart|XML|JSON|Python|PHP|Ruby)$/.test(f.lang) && notTest(f) && !/readme|docs?\//i.test(f.path),
      1,
      true,
    );
    if (!disclosure.length) add("ai-disclosure-missing", llm.refs.slice(0, 3));
  }
  return hits;
}

export function runChecks(snapshot: Snapshot, classification: Classification): CheckHit[] {
  const flags = projectFlags(classification);
  const hits = LINE_CHECKS.flatMap((c) => runLineCheck(c, snapshot.files, flags));
  // Merge hits of the same check in the same file (a check can have several language variants).
  const merged = new Map<string, CheckHit>();
  for (const h of [...hits, ...repoChecks(snapshot, classification, flags)]) {
    const key = `${h.checkId}|${h.path}`;
    const prev = merged.get(key);
    if (prev) prev.refs = [...prev.refs, ...h.refs].slice(0, MAX_REFS_PER_FILE);
    else merged.set(key, { ...h });
  }
  return [...merged.values()];
}
