import { Check, Circle } from "lucide-react";
import { useState } from "react";
import { api, paths } from "../api";
import { Badge, Empty, Meter, SectionHead, Spinner } from "../components/ui";
import { useShell, useToast } from "../context";
import { ago, go, href, loc } from "../hooks";
import { type Audit, SEVERITIES } from "../types";

export function Overview() {
  const shell = useShell();
  const toast = useToast();
  const { profile, audit, audits, meta, pid } = shell;
  const [busy, setBusy] = useState(false);
  const c = profile?.classification;
  const viewer = meta.account?.role === "viewer";

  const runAudit = async (mode: "static" | "agent") => {
    setBusy(true);
    try {
      const r = await api.post<{ audit: Audit; jobId?: string }>(paths.project(pid, "/audits"), { mode });
      shell.selectAudit(null);
      shell.refresh();
      if (r.jobId) shell.openJob(r.jobId);
      toast.success(mode === "agent" ? "Detectors done. The agent is investigating." : `${r.audit.findings.length} findings from the detectors.`, `Audit ${r.audit.id}`);
      if (mode === "static") go(href(pid, "findings"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const s = audit?.summary;
  const steps = [
    { done: Boolean(profile && profile.completeness.answered > 0 && !profile.completeness.unconfirmed.length), label: "Confirm the profile answers", tab: "profile" as const },
    { done: Boolean(profile && !profile.completeness.missingForScope.length), label: "Decide the scope", tab: "scope" as const },
    { done: Boolean(audits?.length), label: "Run an audit", tab: "overview" as const },
    { done: Boolean(s && s.total > 0 && s.open + s.reinvestigating === 0), label: "Review every finding", tab: "findings" as const },
    { done: Boolean(s && s.fixReady === 0 && s.fixing === 0 && s.confirmed === 0 && s.total > 0), label: "Fix and accept", tab: "fixes" as const },
  ];

  return (
    <div className="grid-2">
      <section className="section" aria-labelledby="product-h">
        <h2 id="product-h">Product</h2>
        {c ? (
          <>
            <p>{c.purpose ?? c.summary}</p>
            {c.purpose && <p className="muted small">{c.summary}</p>}
            <p className="muted small">
              {[...c.productTypes, ...c.languages.slice(0, 4).map((l) => `${l.name} (${l.files})`)].join(" · ")}
            </p>
            {c.signals.length > 0 && (
              <details className="signals small">
                <summary>{c.signals.length} signals in the code</summary>
                <ul>
                  {c.signals.map((x) => (
                    <li key={x.id}>
                      {x.label} <span className="mono muted">{loc(x.refs[0])}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : (
          <p className="muted">Not scanned yet.</p>
        )}
        <div className="form-actions" style={{ marginTop: 12 }}>
          {meta.provider && !viewer && (
            <button className="btn btn-sm" onClick={() => shell.startJob(paths.project(pid, "/understand"))} disabled={Boolean(shell.running)}>
              Understand the product
            </button>
          )}
          <a className="btn btn-sm btn-ghost" href={href(pid, "profile")}>
            Edit profile
          </a>
        </div>
      </section>

      <section className="section" aria-labelledby="steps-h">
        <h2 id="steps-h">Next steps</h2>
        <ol className="checklist">
          {steps.map((x) => (
            <li key={x.label} className={x.done ? "done" : ""}>
              {x.done ? <Check size={15} aria-hidden /> : <Circle size={15} aria-hidden />}
              <a href={href(pid, x.tab)}>{x.label}</a>
              <span className="sr-only">{x.done ? " (done)" : " (to do)"}</span>
            </li>
          ))}
        </ol>
        {!viewer && (
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => runAudit("static")} disabled={busy || Boolean(shell.running)}>
              {busy ? <Spinner label="Running…" /> : "Run detector audit"}
            </button>
            {meta.provider ? (
              <button className="btn" onClick={() => runAudit("agent")} disabled={busy || Boolean(shell.running)} title={`Sends code excerpts to ${meta.provider.destination}`}>
                Run agent audit
              </button>
            ) : (
              <span className="muted small">No model: detectors only.</span>
            )}
          </div>
        )}
      </section>

      <section className="section span-2" aria-labelledby="latest-h">
        <SectionHead
          id="latest-h"
          title="Latest audit"
          description={
            audit && s ? (
              <>
                <span className="mono">{audit.id}</span> · {audit.mode} · {ago(audit.createdAt)} · {audit.phase}
                {audit.scan.revision && (
                  <>
                    {" "}
                    · <span className="mono">{audit.scan.revision.slice(0, 10)}</span>
                  </>
                )}
                {audit.scan.dirty && " (uncommitted changes)"}
                {audit.trigger && <> · {audit.trigger.provider} {audit.trigger.event === "push" ? `push to ${audit.trigger.ref ?? "?"}` : audit.trigger.event}</>}
              </>
            ) : undefined
          }
        />
        {!audit || !s ? (
          <Empty title="No audit yet">Run the detector audit to check this repository against the frameworks in scope.</Empty>
        ) : (
          <div className="audit-summary">
            <div className="sev-bars">
              {SEVERITIES.map((sv) => (
                <div key={sv} className="sev-bar">
                  <span className={`sev sev-${sv}`}>
                    <i aria-hidden />
                    {sv}
                  </span>
                  <Meter value={s.bySeverity[sv]} max={Math.max(1, ...SEVERITIES.map((x) => s.bySeverity[x]))} label={`${sv} findings open`} tone={sv} />
                  <span className="num">{s.bySeverity[sv]}</span>
                </div>
              ))}
            </div>
            <dl className="stats">
              <div>
                <dt>To review</dt>
                <dd>
                  <a href={href(pid, "findings")}>{s.open + s.reinvestigating}</a>
                </dd>
              </div>
              <div>
                <dt>Confirmed</dt>
                <dd>{s.confirmed}</dd>
              </div>
              <div>
                <dt>Fixes to review</dt>
                <dd>
                  <a href={href(pid, "fixes")}>{s.fixReady}</a>
                </dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd>{s.resolved}</dd>
              </div>
              <div>
                <dt>Rejected</dt>
                <dd>{s.rejected}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{s.total}</dd>
              </div>
            </dl>
          </div>
        )}
        {audit?.error && <p className="bad-text">Last agent run: {audit.error}</p>}
        {audit && audit.notes.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary>{audit.notes.length} audit notes</summary>
            <ul className="notes">
              {audit.notes.map((n, i) => (
                <li key={i}>
                  <Badge>{n.category}</Badge> {n.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {audits && audits.length > 1 && (
        <section className="section span-2" aria-labelledby="history-h">
          <h2 id="history-h">Audit history</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Audit</th>
                  <th>When</th>
                  <th>Mode</th>
                  <th>Revision</th>
                  <th className="num">Findings</th>
                  <th className="num">To review</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={a.id} aria-current={a.id === audit?.id ? "true" : undefined}>
                    <td className="mono">{a.id}</td>
                    <td>{ago(a.createdAt)}</td>
                    <td>{a.mode}</td>
                    <td className="mono">{a.revision?.slice(0, 10) ?? ""}</td>
                    <td className="num">{a.summary.total}</td>
                    <td className="num">{a.summary.open + a.summary.reinvestigating}</td>
                    <td className="actions-cell">
                      {a.id === audit?.id ? (
                        <span className="muted small">Viewing</span>
                      ) : (
                        <button className="btn btn-sm" onClick={() => shell.selectAudit(a.id === audits[0].id ? null : a.id)}>
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
