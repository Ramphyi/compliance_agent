import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { paths } from "../api";
import { JobPanel, JobStatusBadge } from "../components/JobLog";
import { ActorTag, Empty, ErrorBox, Loading } from "../components/ui";
import { useShell } from "../context";
import { ago, fmtTime, useResource } from "../hooks";
import type { Journal } from "../types";

function summarize(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["note", "reason", "summary", "presetId", "value", "verdict", "error", "commit", "auditId"]) if (d[k]) parts.push(`${k}: ${String(d[k]).slice(0, 120)}`);
  if (Array.isArray(d.ids)) parts.push(`ids: ${(d.ids as string[]).join(", ")}`);
  if (Array.isArray(d.commands)) parts.push(`commands: ${(d.commands as string[]).join(" && ")}`);
  if (d.findings && typeof d.findings === "object") parts.push(`findings: ${(d.findings as { total?: number }).total ?? ""}`);
  return parts.join(" · ");
}

export function Activity() {
  const shell = useShell();
  const { data, error, reload } = useResource<Journal>(paths.project(shell.pid, "/journal?limit=300"), shell.version);
  const [openJob, setOpenJob] = useState<string | null>(null);
  return (
    <div className="grid-2">
      <section className="card span-2-sm">
        <div className="card-head">
          <h2>Audit trail</h2>
          <span className="grow" />
          {data &&
            (data.integrity.ok ? (
              <span className="ok-text small"><ShieldCheck size={14} aria-hidden /> Hash chain intact ({data.integrity.entries} entries)</span>
            ) : (
              <span className="bad-text small"><ShieldAlert size={14} aria-hidden /> Hash chain broken at entry {data.integrity.brokenAt}</span>
            ))}
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        {!data ? (
          !error && <Loading what="journal" />
        ) : !data.entries.length ? (
          <Empty title="Nothing recorded yet" />
        ) : (
          <ol className="journal">
            {data.entries.map((e) => (
              <li key={e.seq}>
                <time className="muted small" dateTime={e.at} title={fmtTime(e.at)}>{ago(e.at)}</time>
                <ActorTag actor={e.actor} />
                <strong>{e.action}</strong>
                {e.target && <span className="mono small">{e.target}</span>}
                <span className="muted small journal-data">{summarize(e.data)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="card">
        <h2>Agent jobs</h2>
        {!shell.jobs.length ? (
          <p className="muted">No jobs in this server session.</p>
        ) : (
          <ul className="jobs">
            {shell.jobs.map((j) => (
              <li key={j.id}>
                <button className="link-btn row" onClick={() => setOpenJob(openJob === j.id ? null : j.id)} aria-expanded={openJob === j.id}>
                  <JobStatusBadge status={j.status} />
                  <span>{j.title}</span>
                  <span className="muted small">{ago(j.startedAt)}</span>
                </button>
                {openJob === j.id && <JobPanel jobId={j.id} version={shell.jobVersion} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
