import { CheckCircle2, FileCode2, XCircle } from "lucide-react";
import { useState } from "react";
import { paths } from "../api";
import { fmtMs, useResource } from "../hooks";
import type { CodeRef, VerificationRun } from "../types";
import { Spinner } from "./ui";

type FileSlice = { path: string; from: number; to: number; total: number; lines: string[] };

/** A few lines of the real file around a finding location, with the flagged lines highlighted. */
export function CodeView({ pid, at, version }: { pid: string; at: CodeRef; version?: number }) {
  const [ctx, setCtx] = useState(6);
  const start = at.line ?? 1;
  const end = at.endLine ?? at.line ?? 1;
  const from = at.line ? Math.max(1, start - ctx) : 1;
  const to = at.line ? end + ctx : ctx * 2;
  const { data, error } = useResource<FileSlice>(paths.file(pid, at.path, from, to), version);
  const more = data && (data.from > 1 || data.to < data.total);
  return (
    <figure className="code">
      <figcaption>
        <FileCode2 size={14} aria-hidden />
        <span className="mono">
          {at.path}
          {at.line ? `:${at.line}${at.endLine && at.endLine !== at.line ? `-${at.endLine}` : ""}` : ""}
        </span>
        {more && (
          <button className="link-btn" onClick={() => setCtx((c) => c + 20)}>
            More context
          </button>
        )}
      </figcaption>
      {error ? (
        <div className="code-error">
          <span>{error}</span>
          {at.excerpt && <pre>{at.excerpt}</pre>}
        </div>
      ) : !data ? (
        <div className="code-loading">
          <Spinner />
        </div>
      ) : (
        <pre tabIndex={0} aria-label={`Source of ${at.path}`}>
          {data.lines.map((l, i) => {
            const n = data.from + i;
            const hit = Boolean(at.line) && n >= start && n <= end;
            return (
              <span key={n} className={hit ? "cl hit" : "cl"}>
                <span className="ln" aria-hidden>
                  {n}
                </span>
                {hit && <span className="sr-only">Flagged line: </span>}
                {l || " "}
              </span>
            );
          })}
        </pre>
      )}
    </figure>
  );
}

type DiffLine = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; a?: number; b?: number };
type DiffFile = { name: string; lines: DiffLine[]; add: number; del: number };

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let a = 0;
  let b = 0;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (head) {
      files.push((cur = { name: head[2], lines: [], add: 0, del: 0 }));
      continue;
    }
    if (!cur) files.push((cur = { name: "changes", lines: [], add: 0, del: 0 }));
    if (/^(index |new file mode|deleted file mode|similarity |rename |old mode|new mode)/.test(line)) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      if (line.startsWith("+++ ") && cur.name === "changes") cur.name = line.slice(4).replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      a = Number(hunk[1]);
      b = Number(hunk[2]);
      cur.lines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      cur.add++;
      cur.lines.push({ kind: "add", text: line, b: b++ });
    } else if (line.startsWith("-")) {
      cur.del++;
      cur.lines.push({ kind: "del", text: line, a: a++ });
    } else if (line.startsWith("\\")) cur.lines.push({ kind: "meta", text: line });
    else cur.lines.push({ kind: "ctx", text: line, a: a++, b: b++ });
  }
  return files;
}

/** Unified diff with file headers, line numbers and coloured additions and deletions. */
export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="muted">No diff was recorded.</p>;
  return (
    <div className="diff">
      {parseDiff(diff).map((f, i) => (
        <section key={i} className="diff-file" aria-label={`Changes in ${f.name}`}>
          <header>
            <FileCode2 size={14} aria-hidden />
            <span className="mono">{f.name}</span>
            <span className="diff-stat">
              <span className="add">+{f.add}</span> <span className="del">−{f.del}</span>
            </span>
          </header>
          <pre tabIndex={0}>
            {f.lines.map((l, j) => (
              <span key={j} className={`dl dl-${l.kind}`}>
                <span className="ln" aria-hidden>
                  {l.a ?? ""}
                </span>
                <span className="ln" aria-hidden>
                  {l.b ?? ""}
                </span>
                {l.kind === "add" && <span className="sr-only">Added: </span>}
                {l.kind === "del" && <span className="sr-only">Removed: </span>}
                {l.text || " "}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}

/** Build and test command results, each with collapsible output. */
export function VerifyRuns({ runs }: { runs: VerificationRun[] }) {
  if (!runs.length) return <p className="muted">No verification commands ran.</p>;
  return (
    <ul className="runs">
      {runs.map((r, i) => (
        <li key={i}>
          <details>
            <summary>
              {r.passed ? <CheckCircle2 size={15} className="ok" aria-hidden /> : <XCircle size={15} className="bad" aria-hidden />}
              <span className="sr-only">{r.passed ? "Passed" : "Failed"}: </span>
              <code>{r.command}</code>
              <span className="muted">
                {r.timedOut ? "timed out" : `exit ${r.exitCode ?? "?"}`} · {fmtMs(r.durationMs)}
              </span>
            </summary>
            <pre className="output">{r.output || "(no output)"}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}
