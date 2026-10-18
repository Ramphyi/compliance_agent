import { Bot, Check, Circle, Play, ScanSearch } from "lucide-react";
import { useState } from "react";
import { api, paths } from "../api";
import { Badge, Empty, Meter, Spinner } from "../components/ui";
import { useShell, useToast } from "../context";
import { ago, go, href, loc } from "../hooks";
import { type Audit, SEVERITIES } from "../types";

export function Overview() {
  const shell = useShell();
  const toast = useToast();
  const { profile, audit, audits, meta, pid } = shell;
  const [busy, setBusy] = useState(false);
  const c = profile?.classification;

  const runAudit = async (mode: "static" | "agent") => {
    setBusy(true);
    try {
      const r = await api.post<{ audit: Audit; jobId?: string }>(paths.project(pid, "/audits"), { mode });
      shell.selectAudit(null);
      shell.refresh();
      if (r.jobId) shell.openJob(r.jobId);
      toast.success(mode === "agent" ? "Detectors ran; the agent is now investigating." : `${r.audit.findings.length} findings from the detectors.`, `Audit ${r.audit.id}`);
      if (mode === "static") go(href(pid, "findings"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const s = audit?.summary;
  const steps = [
    { done: Boolean(profile && profile.completeness.answered > 0 && !profile.completeness.unconfirmed.length), label: "Profile answers confirmed", tab: "profile" as const },
    { done: Boolean(profile && !profile.completeness.missingForScope.length), label: "Scope decided (no undecided frameworks)", tab: "scope" as const },
    { done: Boolean(audits?.length), label: "Audit run", tab: "overview" as const },
    { done: Boolean(s && s.total > 0 && s.open + s.reinvestigating === 0), label: "Every finding reviewed", tab: "findings" as const },
    { done: Boolean(s && s.fixReady === 0 && s.fixing === 0 && s.confirmed === 0 && s.total > 0), label: "Fixes made and accepted", tab: "fixes" as const },
  ];

  return (
    <div className="grid-2">
      <section className="card">
        <h2>Product</h2>
        {c ? (
          <>
            <p className="lead">{c.purpose ?? c.summary}</p>
            {c.purpose && <p className="muted">{c.summary}</p>}
            <div className="chips">
              {c.productTypes.map((t) => <Badge key={t} tone="teal">{t}</Badge>)}
              {c.languages.slice(0, 5).map((l) => <Badge key={l.name}>{l.name} · {l.files}</Badge>)}
            </div>
            <details className="signals">
              <summary>{c.signals.length} signals detected in the code</summary>
              <ul>
                {c.signals.map((x) => (
                  <li key={x.id}>
                    {x.label} <span className="mono muted">{loc(x.refs[0])}</span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p className="muted">Not scanned yet. Run an audit or rescan from the Profile tab.</p>
        )}
        <div className="row">
          {meta.provider && (
            <button className="btn" onClick={() => shell.startJob(paths.project(pid, "/understand"))} disabled={Boolean(shell.running)}>
              <Bot size={14} aria-hidden /> Understand the product
            </button>
          )}
          <a className="btn btn-ghost" href={href(pid, "profile")}>Edit profile</a>
        </div>
      </section>

      <section className="card">
        <h2>Next steps</h2>
        <ol className="checklist">
          {steps.map((x) => (
            <li key={x.label} className={x.done ? "done" : ""}>
              {x.done ? <Check size={15} aria-hidden /> : <Circle size={15} aria-hidden />}
              <a href={href(pid, x.tab)}>{x.label}</a>
              <span className="sr-only">{x.done ? " (done)" : " (to do)"}</span>
            </li>
          ))}
        </ol>
        <div className="row">
          <button className="btn btn-primary" onClick={() => runAudit("static")} disabled={busy || Boolean(shell.running)}>
            {busy ? <Spinner label="Running…" /> : <><ScanSearch size={14} aria-hidden /> Run detector audit</>}
          </button>
          {meta.provider ? (
            <button className="btn btn-accent" onClick={() => runAudit("agent")} disabled={busy || Boolean(shell.running)} title={`Sends code excerpts to ${meta.provider.destination}`}>
              <Play size={14} aria-hidden /> Run agent audit
            </button>
          ) : (
            <span className="muted small">No model here: detectors only, or connect an MCP host (Settings).</span>
          )}
        </div>
      </section>

      <section className="card span-2">
        <h2>Latest audit</h2>
        {!audit || !s ? (
          <Empty title="No audit yet">Run the detector audit to map this repository to the frameworks in scope.</Empty>
        ) : (
          <div className="audit-summary">
            <div>
              <div className="muted small">
                {audit.id} · {audit.mode} · {ago(audit.createdAt)} · phase <strong>{audit.phase}</strong>
                {audit.scan.revision && <> · <span className="mono">{audit.scan.revision.slice(0, 10)}</span></>}
                {audit.scan.dirty && " (uncommitted changes)"}
              </div>
              <div className="sev-bars">
                {SEVERITIES.map((sv) => (
                  <div key={sv} className="sev-bar">
                    <span className={`sev sev-${sv}`}><i aria-hidden />{sv}</span>
                    <Meter value={s.bySeverity[sv]} max={Math.max(1, ...SEVERITIES.map((x) => s.bySeverity[x]))} label={`${sv} findings open`} tone={sv} />
                    <span className="num">{s.bySeverity[sv]}</span>
                  </div>
                ))}
              </div>
            </div>
            <dl className="stats">
              <div><dt>Need a decision</dt><dd><a href={href(pid, "findings")}>{s.open + s.reinvestigating}</a></dd></div>
              <div><dt>Confirmed</dt><dd>{s.confirmed}</dd></div>
              <div><dt>Fixes to review</dt><dd><a href={href(pid, "fixes")}>{s.fixReady}</a></dd></div>
              <div><dt>Resolved</dt><dd>{s.resolved}</dd></div>
              <div><dt>Rejected</dt><dd>{s.rejected}</dd></div>
              <div><dt>Total</dt><dd>{s.total}</dd></div>
            </dl>
          </div>
        )}
        {audit?.error && <p className="bad-text">Last agent run: {audit.error}</p>}
        {audit && audit.notes.length > 0 && (
          <details>
            <summary>{audit.notes.length} audit notes</summary>
            <ul className="notes">
              {audit.notes.map((n, i) => <li key={i}><Badge>{n.category}</Badge> {n.text}</li>)}
            </ul>
          </details>
        )}
      </section>

      {audits && audits.length > 1 && (
        <section className="card span-2">
          <h2>Audit history</h2>
          <table className="table">
            <thead>
              <tr><th>Audit</th><th>When</th><th>Mode</th><th>Revision</th><th>Findings</th><th>Open</th><th /></tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} aria-current={a.id === audit?.id ? "true" : undefined}>
                  <td className="mono">{a.id}</td>
                  <td>{ago(a.createdAt)}</td>
                  <td>{a.mode}</td>
                  <td className="mono">{a.revision?.slice(0, 10) ?? "—"}</td>
                  <td>{a.summary.total}</td>
                  <td>{a.summary.open + a.summary.reinvestigating}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => shell.selectAudit(a.id === audits[0].id ? null : a.id)} disabled={a.id === audit?.id}>
                      {a.id === audit?.id ? "Viewing" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
