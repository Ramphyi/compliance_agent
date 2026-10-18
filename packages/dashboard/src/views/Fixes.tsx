import { GitCommitHorizontal, RotateCcw, Wrench } from "lucide-react";
import { paths } from "../api";
import { DiffView, VerifyRuns } from "../components/code";
import { ACTION_LABELS, useReviewFlow } from "../components/review";
import { ActorTag, Badge, Empty, Loading, SeverityBadge, StatusBadge } from "../components/ui";
import { useShell } from "../context";
import { StuckFix } from "./Findings";
import { fmtTime, href } from "../hooks";

export function Fixes() {
  const shell = useShell();
  const { audit, pid, meta } = shell;
  const flow = useReviewFlow();
  if (audit === undefined) return <Loading what="fixes" />;
  const list = (audit?.findings ?? []).filter((f) => ["fixing", "fix_ready", "fix_failed"].includes(f.status) || (f.fix && f.status === "confirmed"));
  if (!list.length)
    return (
      <Empty icon={<Wrench size={28} />} title="No fixes yet">
        Confirm findings in <a href={href(pid, "findings")}>Findings</a>, then fix them with the agent
        {meta.provider ? "" : " or from an MCP host such as Claude Code"}. Every fix is built, tested and committed on a fix branch for you to accept or revert.
      </Empty>
    );
  return (
    <div className="stack-lg">
      {list.map((f) => (
        <article key={f.id} className="card fix-card">
          <header className="row wrap">
            <SeverityBadge severity={f.severity} />
            <StatusBadge status={f.status} />
            <a className="mono small" href={href(pid, "findings", f.id)}>{f.id}</a>
            <h2 className="grow">{f.title}</h2>
          </header>
          {f.fix ? (
            <>
              <div className="row wrap muted small">
                {f.fix.commit && (
                  <span><GitCommitHorizontal size={13} aria-hidden /> <span className="mono">{f.fix.commit.slice(0, 10)}</span> on <span className="mono">{f.fix.branch}</span></span>
                )}
                <span>attempt {f.fix.attempts}</span>
                <span>by <ActorTag actor={f.fix.by} /></span>
                <span>{fmtTime(f.fix.finishedAt ?? f.fix.startedAt)}</span>
              </div>
              {f.fix.summary && <p>{f.fix.summary}</p>}
              {f.fix.error && <p className="callout callout-error">{f.fix.error}</p>}
              {f.fix.recheck?.map((r) => (
                <p key={r.checkId} className="small">
                  Detector <code>{r.checkId}</code>: {r.stillPresent ? <Badge tone="danger">still matches</Badge> : <Badge tone="teal">no longer matches</Badge>}
                </p>
              ))}
              <h3>Verification</h3>
              <VerifyRuns runs={f.fix.verification} />
              <h3>Changes {f.fix.filesChanged.length > 0 && <span className="muted small">({f.fix.filesChanged.join(", ")})</span>}</h3>
              <DiffView diff={f.fix.diff} />
            </>
          ) : (
            <p className="muted">The fix is starting…</p>
          )}
          <div className="actions">
            {f.actions.filter((a) => ["accept-fix", "revert-fix", "modify", "reopen", "resolve", "confirm"].includes(a)).map((a) => (
              <button key={a} className={`btn btn-sm ${a === "accept-fix" ? "btn-primary" : a === "revert-fix" ? "btn-danger" : ""}`} onClick={() => flow.act(a, [f])} disabled={flow.busy}>
                {a === "modify" ? "Modify instructions" : ACTION_LABELS[a]}
              </button>
            ))}
            {f.status === "fixing" && !shell.running && audit && <StuckFix pid={pid} auditId={audit.id} findingId={f.id} canResume={Boolean(meta.provider)} />}
            {meta.provider && audit && (f.status === "fix_failed" || f.status === "confirmed") && (
              <button className="btn btn-sm btn-accent" disabled={Boolean(shell.running)} onClick={() => shell.startJob(paths.finding(pid, audit.id, f.id, "/fix"))}>
                <RotateCcw size={13} aria-hidden /> Retry fix
              </button>
            )}
          </div>
        </article>
      ))}
      {flow.dialogs}
    </div>
  );
}
