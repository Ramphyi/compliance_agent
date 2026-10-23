import { Keyboard, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, paths } from "../api";
import { CodeView } from "../components/code";
import { ACTION_LABELS, useReviewFlow } from "../components/review";
import { HandoffModal } from "../components/handoff";
import { ActorTag, Empty, Loading, SeverityBadge, StatusBadge } from "../components/ui";
import { useShell, useToast } from "../context";
import { fmtTime, go, href, loc } from "../hooks";
import { categoryLabel, type Finding, findingFrameworks, frameworkKindLabel, SEVERITIES, type Severity } from "../types";

type Group = "decide" | "confirmed" | "fixes" | "closed" | "all";
const GROUPS: Record<Group, { label: string; statuses?: string[] }> = {
  decide: { label: "To review", statuses: ["open", "reinvestigating"] },
  confirmed: { label: "Confirmed", statuses: ["confirmed"] },
  fixes: { label: "Fixes", statuses: ["fixing", "fix_ready", "fix_failed"] },
  closed: { label: "Closed", statuses: ["resolved", "rejected", "withdrawn"] },
  all: { label: "All" },
};

export function Findings({ selectedId }: { selectedId?: string }) {
  const shell = useShell();
  const { audit, pid, meta } = shell;
  const [group, setGroup] = useState<Group>("decide");
  const [sev, setSev] = useState<Set<Severity>>(new Set());
  const [kind, setKind] = useState<"all" | "code" | "evidence">("all");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [framework, setFramework] = useState("all");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [help, setHelp] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const flow = useReviewFlow(() => setPicked(new Set()));
  const viewer = meta.account?.role === "viewer";
  const listRef = useRef<HTMLUListElement>(null);

  const findings = audit?.findings ?? [];
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return findings.filter((f) => {
      const g = GROUPS[group].statuses;
      if (g && !g.includes(f.status)) return false;
      if (sev.size && !sev.has(f.severity)) return false;
      if (kind === "code" && f.kind === "missing-artifact") return false;
      if (kind === "evidence" && f.kind !== "missing-artifact") return false;
      if (source !== "all" && f.source !== source) return false;
      if (category !== "all" && f.category !== category) return false;
      if (framework !== "all" && !f.controls.some((c) => c.frameworkId === framework)) return false;
      if (needle && !`${f.id} ${f.title} ${f.description} ${f.locations.map((l) => l.path).join(" ")} ${f.controlIds.join(" ")} ${f.controls.map((c) => c.framework).join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findings, group, sev, kind, source, category, framework, q]);

  const current = findings.find((f) => f.id === selectedId) ?? list[0];
  const idx = current ? list.findIndex((f) => f.id === current.id) : -1;
  const select = (f?: Finding) => f && go(href(pid, "findings", f.id), true);

  // Keyboard review: j/k move, c/r/m/i act, x toggles selection, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector(".overlay")) return;
      const k = e.key;
      if (k === "j" || k === "ArrowDown") select(list[Math.min(list.length - 1, idx + 1)]);
      else if (k === "k" || k === "ArrowUp") select(list[Math.max(0, idx - 1)]);
      else if (k === "?") setHelp((h) => !h);
      else if (!current || viewer) return;
      else if (k === "x") setPicked((p) => toggle(p, current.id));
      else if (k === "c") flow.act("confirm", [current]);
      else if (k === "r") flow.act("reject", [current]);
      else if (k === "m") flow.act("modify", [current]);
      else if (k === "i") flow.act("reinvestigate", [current]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[aria-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [current?.id]);

  if (audit === undefined) return <Loading what="findings" />;
  if (audit === null)
    return (
      <Empty title="No audit yet">
        Run an audit from the <a href={href(pid, "overview")}>Overview</a>.
      </Empty>
    );

  const confirmed = findings.filter((f) => f.status === "confirmed" && f.fixability !== "process").length;
  const categories = [...new Set(findings.map((f) => f.category))].sort();
  const frameworks = [...new Map(findings.flatMap(findingFrameworks).map((fw) => [fw.id, fw])).values()].sort((a, b) => a.title.localeCompare(b.title));
  const kinds = [...new Set(frameworks.map((fw) => frameworkKindLabel(fw.kind)))].sort();
  const pickedFindings = findings.filter((f) => picked.has(f.id));

  return (
    <div className="review">
      <div className="review-bar">
        <div className="seg" role="group" aria-label="Status">
          {(Object.keys(GROUPS) as Group[]).map((g) => {
            const n = GROUPS[g].statuses ? findings.filter((f) => GROUPS[g].statuses!.includes(f.status)).length : findings.length;
            return (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>
                {GROUPS[g].label} <span className="count">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="chips" role="group" aria-label="Severity">
          {SEVERITIES.map((s) => (
            <button key={s} type="button" className={`chip sev-${s}`} aria-pressed={sev.has(s)} onClick={() => setSev((x) => toggle(x, s))}>
              <i aria-hidden style={{ background: `var(--sev-${s})` }} />
              {s}
            </button>
          ))}
        </div>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Any kind</option>
          <option value="code">Code issues</option>
          <option value="evidence">Evidence gaps</option>
        </select>
        <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">Any source</option>
          <option value="check">Detector</option>
          <option value="artifact">Evidence check</option>
          <option value="agent">Acai agent</option>
          <option value="mcp-host">Connected agent</option>
          <option value="human">Reviewer</option>
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <select aria-label="Framework" value={framework} onChange={(e) => setFramework(e.target.value)}>
          <option value="all">All frameworks</option>
          {kinds.map((k) => (
            <optgroup key={k} label={`${k}s`}>
              {frameworks.filter((fw) => frameworkKindLabel(fw.kind) === k).map((fw) => <option key={fw.id} value={fw.id}>{fw.title}</option>)}
            </optgroup>
          ))}
        </select>
        <label className="search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search findings" aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="grow" />
        <button className="btn btn-sm" onClick={() => setHandoff(true)} title="The findings as tasks for Claude Code, Codex, Copilot, Cursor or another coding agent">
          Hand off to agent
        </button>
        {meta.provider && !viewer && (
          <button className="btn btn-sm" disabled={!confirmed || Boolean(shell.running)} onClick={() => shell.startJob(paths.audit(pid, audit.id, "/fix-confirmed"))} title="Acai's agent fixes each confirmed finding, builds, tests and commits it on a fix branch">
            Fix {confirmed} confirmed
          </button>
        )}
        <button className="icon-btn" onClick={() => setHelp((h) => !h)} aria-label="Keyboard shortcuts" aria-expanded={help}>
          <Keyboard size={16} />
        </button>
      </div>
      {handoff && <HandoffModal pid={pid} auditId={audit.id} onClose={() => setHandoff(false)} />}
      {help && (
        <p className="shortcuts muted small">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>c</kbd> confirm · <kbd>r</kbd> reject · <kbd>m</kbd> modify · <kbd>i</kbd> re-investigate · <kbd>x</kbd> select · <kbd>?</kbd> toggle help
        </p>
      )}
      {picked.size > 0 && !viewer && (
        <div className="bulk-bar" role="region" aria-label="Bulk actions">
          <strong>{picked.size} selected</strong>
          <button className="btn btn-sm btn-primary" onClick={() => flow.act("confirm", pickedFindings)} disabled={flow.busy}>Confirm</button>
          <button className="btn btn-sm btn-danger" onClick={() => flow.act("reject", pickedFindings)} disabled={flow.busy}>Reject…</button>
          <button className="btn btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      <div className="review-split">
        <ul className="f-list" ref={listRef} aria-label="Findings">
          {list.map((f) => (
            <li key={f.id} aria-current={f.id === current?.id ? "true" : undefined}>
              {!viewer && <input type="checkbox" aria-label={`Select ${f.id}`} checked={picked.has(f.id)} onChange={() => setPicked((p) => toggle(p, f.id))} />}
              <a href={href(pid, "findings", f.id)} onClick={(e) => (e.preventDefault(), select(f))}>
                <div className="f-row1">
                  <SeverityBadge severity={f.severity} />
                  <span className="mono small muted">{f.id}</span>
                  <span className="grow" />
                  <StatusBadge status={f.status} />
                </div>
                <div className="f-title">{f.title}</div>
                <FrameworkTags f={f} max={2} />
                <div className="mono small muted truncate">{f.kind === "missing-artifact" ? "Evidence gap" : loc(f.locations[0])}</div>
              </a>
            </li>
          ))}
          {!list.length && <li className="muted empty-row">No findings match these filters.</li>}
        </ul>
        <div className="f-detail">{current ? <Detail f={current} flow={flow} readOnly={viewer} /> : <Empty title="Nothing selected" />}</div>
      </div>
      {flow.dialogs}
    </div>
  );
}

function Detail({ f, flow, readOnly }: { f: Finding; flow: ReturnType<typeof useReviewFlow>; readOnly: boolean }) {
  const shell = useShell();
  const { pid, audit, meta } = shell;
  const source = f.source === "check" ? `Detector ${f.checkId}` : f.source === "artifact" ? "Evidence check" : f.source === "agent" ? "Acai agent" : f.source === "mcp-host" ? "Connected agent" : "Reviewer";
  return (
    <article className="detail" aria-labelledby={`t-${f.id}`}>
      <header>
        <div className="detail-meta">
          <SeverityBadge severity={f.severity} />
          <StatusBadge status={f.status} />
          <span>{categoryLabel(f.category)}</span>
          <span>{source}</span>
          <span>{f.confidence} confidence</span>
          <span className="mono">{f.id}</span>
        </div>
        <h2 id={`t-${f.id}`}>{f.title}</h2>
        <FrameworkTags f={f} />
      </header>

      {!readOnly && (
        <div className="actions" role="toolbar" aria-label="Review actions">
          {f.actions.map((a) => (
            <button
              key={a}
              className={`btn btn-sm ${a === "confirm" || a === "accept-fix" ? "btn-primary" : a === "reject" || a === "revert-fix" ? "btn-danger" : ""}`}
              onClick={() => flow.act(a, [f])}
              disabled={flow.busy}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
          {meta.provider && (f.status === "confirmed" || f.status === "fix_failed") && f.fixability !== "process" && audit && (
            <button className="btn btn-sm" disabled={Boolean(shell.running)} onClick={() => shell.startJob(paths.finding(pid, audit.id, f.id, "/fix"))}>
              Fix with agent
            </button>
          )}
          {meta.provider && f.status === "reinvestigating" && audit && (
            <button className="btn btn-sm" disabled={Boolean(shell.running)} onClick={() => shell.startJob(paths.finding(pid, audit.id, f.id, "/reinvestigate"))}>
              Run re-investigation
            </button>
          )}
          {f.status === "fixing" && !shell.running && audit && <StuckFix pid={pid} auditId={audit.id} findingId={f.id} canResume={Boolean(meta.provider)} />}
          {f.fix && (
            <a className="btn btn-sm btn-ghost" href={href(pid, "fixes")}>
              View fix
            </a>
          )}
        </div>
      )}

      {f.reinvestigateNote && f.status === "reinvestigating" && <p className="callout callout-warn"><span><strong>Re-investigate:</strong> {f.reinvestigateNote}</span></p>}
      <p>{f.description}</p>
      {f.locations.slice(0, 3).map((l, i) => <CodeView key={i} pid={pid} at={l} version={shell.version} />)}
      {f.locations.length > 3 && (
        <details>
          <summary>{f.locations.length - 3} more locations</summary>
          <ul className="mono small">{f.locations.slice(3).map((l, i) => <li key={i}>{loc(l)} {l.excerpt && <span className="muted">{l.excerpt}</span>}</li>)}</ul>
        </details>
      )}
      <dl className="facts">
        <dt>Evidence</dt>
        <dd>{f.evidence}</dd>
        <dt>Recommendation</dt>
        <dd>{f.recommendation}</dd>
        {f.fixInstructions && (
          <>
            <dt>Fix instructions</dt>
            <dd>{f.fixInstructions}</dd>
          </>
        )}
      </dl>
      {f.controls.length > 0 && (
        <section>
          <h3>Requirements ({f.controls.length})</h3>
          <ul className="control-list">
            {f.controls.map((c) => (
              <li key={c.id}>
                <details>
                  <summary><strong>{c.framework}</strong> <span className="mono small">{c.ref}</span> {c.title}</summary>
                  <p>{c.requirement}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>History</h3>
        {f.history.length ? (
          <ol className="timeline">
            {f.history.map((h, i) => (
              <li key={i}>
                <div className="row wrap">
                  <ActorTag actor={h.by} />
                  <strong>{h.action}</strong>
                  {h.reason && <span className="muted">{h.reason}</span>}
                  <time className="muted small" dateTime={h.at}>{fmtTime(h.at)}</time>
                </div>
                {h.note && <p>{h.note}</p>}
                {h.changes && (
                  <ul className="small">
                    {Object.entries(h.changes).map(([k, v]) => <li key={k}><span className="mono">{k}</span>: <del>{String(v.from ?? "")}</del> → <ins>{String(v.to ?? "")}</ins></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">No decisions yet. Found {fmtTime(f.createdAt)}.</p>
        )}
      </section>
    </article>
  );
}

/** One tag per framework the finding maps to (ISO/IEC 27001, EU GDPR…), coloured by kind. */
function FrameworkTags({ f, max }: { f: Finding; max?: number }) {
  const all = findingFrameworks(f);
  if (!all.length) return null;
  const shown = max ? all.slice(0, max) : all;
  return (
    <span className="fw-tags">
      {shown.map((fw) => (
        <span key={fw.id} className={`badge fw-tag fw-${fw.kind ?? "other"}`} title={`${frameworkKindLabel(fw.kind)} · ${fw.title} ${fw.refs.join(", ")}`}>
          {fw.title}
        </span>
      ))}
      {all.length > shown.length && (
        <span className="badge fw-tag" title={all.slice(shown.length).map((fw) => fw.title).join(", ")}>
          +{all.length - shown.length}
        </span>
      )}
    </span>
  );
}

/** A fix left "in progress" by an interrupted run: resume it, or abandon it (restores the files). */
export function StuckFix({ pid, auditId, findingId, canResume }: { pid: string; auditId: string; findingId: string; canResume: boolean }) {
  const shell = useShell();
  const toast = useToast();
  return (
    <>
      {canResume && (
        <button className="btn btn-sm" onClick={() => shell.startJob(paths.finding(pid, auditId, findingId, "/fix"))}>
          Resume fix
        </button>
      )}
      <button
        className="btn btn-sm btn-danger"
        onClick={() =>
          api
            .post(paths.finding(pid, auditId, findingId, "/abort-fix"), { reason: "Abandoned after an interrupted run." })
            .then(() => (toast.success(`Fix for ${findingId} abandoned. Files restored.`), shell.refresh()))
            .catch(toast.error)
        }
      >
        Abandon fix
      </button>
    </>
  );
}

function toggle<T>(set: Set<T>, v: T) {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}
