import { Bot, FileSearch, Keyboard, Search, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, paths } from "../api";
import { CodeView } from "../components/code";
import { ACTION_LABELS, useReviewFlow } from "../components/review";
import { ActorTag, Badge, Empty, Loading, SeverityBadge, StatusBadge } from "../components/ui";
import { useShell, useToast } from "../context";
import { fmtTime, go, href, loc } from "../hooks";
import { categoryLabel, type Finding, SEVERITIES, type Severity } from "../types";

type Group = "decide" | "confirmed" | "fixes" | "closed" | "all";
const GROUPS: Record<Group, { label: string; statuses?: string[] }> = {
  decide: { label: "Needs decision", statuses: ["open", "reinvestigating"] },
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
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [help, setHelp] = useState(false);
  const flow = useReviewFlow(() => setPicked(new Set()));
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
      if (needle && !`${f.id} ${f.title} ${f.description} ${f.locations.map((l) => l.path).join(" ")} ${f.controlIds.join(" ")}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [findings, group, sev, kind, source, category, q]);

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
      else if (!current) return;
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
      <Empty icon={<FileSearch size={28} />} title="No audit yet">
        Run an audit from the <a href={href(pid, "overview")}>Overview</a>.
      </Empty>
    );

  const confirmed = findings.filter((f) => f.status === "confirmed" && f.fixability !== "process").length;
  const categories = [...new Set(findings.map((f) => f.category))].sort();
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
            <button key={s} type="button" className={`chip chip-${s}`} aria-pressed={sev.has(s)} onClick={() => setSev((x) => toggle(x, s))}>{s}</button>
          ))}
        </div>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">Code issues and evidence gaps</option>
          <option value="code">Code issues</option>
          <option value="evidence">Evidence gaps</option>
        </select>
        <select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">Any source</option>
          <option value="check">Detector</option>
          <option value="artifact">Evidence check</option>
          <option value="agent">Assay agent</option>
          <option value="mcp-host">MCP host</option>
          <option value="human">Reviewer</option>
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <label className="search">
          <Search size={14} aria-hidden />
          <input type="search" placeholder="Search findings" aria-label="Search findings" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <span className="grow" />
        {meta.provider ? (
          <button className="btn btn-accent btn-sm" disabled={!confirmed || Boolean(shell.running)} onClick={() => shell.startJob(paths.audit(pid, audit.id, "/fix-confirmed"))} title="The agent fixes each confirmed finding, builds and tests it, and commits on a fix branch">
            <Wrench size={14} aria-hidden /> Fix {confirmed} confirmed
          </button>
        ) : (
          confirmed > 0 && <span className="muted small" title="In Claude Code: “fix the confirmed Assay findings”">{confirmed} confirmed · fix them from an MCP host</span>
        )}
        <button className="icon-btn" onClick={() => setHelp((h) => !h)} aria-label="Keyboard shortcuts" aria-expanded={help}>
          <Keyboard size={16} />
        </button>
      </div>
      {help && (
        <p className="shortcuts muted small">
          <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>c</kbd> confirm · <kbd>r</kbd> reject · <kbd>m</kbd> modify · <kbd>i</kbd> re-investigate · <kbd>x</kbd> select · <kbd>?</kbd> toggle help
        </p>
      )}
      {picked.size > 0 && (
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
              <input type="checkbox" aria-label={`Select ${f.id}`} checked={picked.has(f.id)} onChange={() => setPicked((p) => toggle(p, f.id))} />
              <a href={href(pid, "findings", f.id)} onClick={(e) => (e.preventDefault(), select(f))}>
                <div className="f-row1">
                  <SeverityBadge severity={f.severity} />
                  <span className="mono small muted">{f.id}</span>
                  <span className="grow" />
                  <StatusBadge status={f.status} />
                </div>
                <div className="f-title">{f.title}</div>
                <div className="mono small muted truncate">{f.kind === "missing-artifact" ? "evidence gap" : loc(f.locations[0])}</div>
              </a>
            </li>
          ))}
          {!list.length && <li className="muted empty-row">No findings match these filters.</li>}
        </ul>
        <div className="f-detail">{current ? <Detail f={current} flow={flow} /> : <Empty title="Nothing selected" />}</div>
      </div>
      {flow.dialogs}
    </div>
  );
}

function Detail({ f, flow }: { f: Finding; flow: ReturnType<typeof useReviewFlow> }) {
  const shell = useShell();
  const { pid, audit, meta } = shell;
  return (
    <article className="detail" aria-labelledby={`t-${f.id}`}>
      <header>
        <div className="row wrap">
          <SeverityBadge severity={f.severity} />
          <StatusBadge status={f.status} />
          <Badge>{categoryLabel(f.category)}</Badge>
          <Badge>{f.source === "check" ? `detector ${f.checkId}` : f.source === "artifact" ? "evidence check" : f.source}</Badge>
          <Badge tone={f.confidence === "high" ? "teal" : f.confidence === "low" ? "warn" : "neutral"}>{f.confidence} confidence</Badge>
          <span className="mono muted small">{f.id}</span>
        </div>
        <h2 id={`t-${f.id}`}>{f.title}</h2>
      </header>

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
          <button className="btn btn-sm btn-accent" disabled={Boolean(shell.running)} onClick={() => shell.startJob(paths.finding(pid, audit.id, f.id, "/fix"))}>
            <Wrench size={13} aria-hidden /> Fix with agent
          </button>
        )}
        {meta.provider && f.status === "reinvestigating" && audit && (
          <button className="btn btn-sm" disabled={Boolean(shell.running)} onClick={() => shell.startJob(paths.finding(pid, audit.id, f.id, "/reinvestigate"))}>
            <Bot size={13} aria-hidden /> Run re-investigation
          </button>
        )}
        {f.status === "fixing" && !shell.running && audit && <StuckFix pid={pid} auditId={audit.id} findingId={f.id} canResume={Boolean(meta.provider)} />}
        {f.fix && <a className="btn btn-sm btn-ghost" href={href(pid, "fixes")}>View fix</a>}
      </div>

      {f.reinvestigateNote && f.status === "reinvestigating" && <p className="callout callout-warn"><strong>Sent back for re-investigation:</strong> {f.reinvestigateNote}</p>}
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
            <dt>Reviewer's fix instructions</dt>
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
                  {h.reason && <Badge>{h.reason}</Badge>}
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

/** A fix left "in progress" by an interrupted run: resume it, or abandon it (restores the files). */
export function StuckFix({ pid, auditId, findingId, canResume }: { pid: string; auditId: string; findingId: string; canResume: boolean }) {
  const shell = useShell();
  const toast = useToast();
  return (
    <>
      {canResume && (
        <button className="btn btn-sm btn-accent" onClick={() => shell.startJob(paths.finding(pid, auditId, findingId, "/fix"))}>
          <Wrench size={13} aria-hidden /> Resume fix
        </button>
      )}
      <button
        className="btn btn-sm btn-danger"
        onClick={() =>
          api
            .post(paths.finding(pid, auditId, findingId, "/abort-fix"), { reason: "Abandoned after an interrupted run." })
            .then(() => (toast.success(`Fix for ${findingId} abandoned; files restored.`), shell.refresh()))
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
