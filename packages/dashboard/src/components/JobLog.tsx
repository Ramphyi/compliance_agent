import { Info, MessageSquareText, Search, Wrench } from "lucide-react";
import { useEffect, useRef } from "react";
import { api, paths } from "../api";
import { useToast } from "../context";
import { fmtMs, useResource } from "../hooks";
import type { Job, JobEvent, JobStatus, VerificationRun } from "../types";
import { VerifyRuns } from "./code";
import { Badge, Drawer, ErrorBox, Loading } from "./ui";

const JOB_TONE: Record<JobStatus, string> = { running: "st-fixing", done: "st-fix_ready", failed: "st-fix_failed", cancelled: "st-withdrawn" };

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`status ${JOB_TONE[status]}`}>
      <i aria-hidden />
      {status}
    </span>
  );
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function brief(input: unknown) {
  if (input === null || input === undefined) return "";
  if (typeof input !== "object") return String(input);
  const s = Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("  ");
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

function EventRow({ e }: { e: JobEvent }) {
  const meta = (
    <>
      <time dateTime={e.at}>{time(e.at)}</time>
      {e.stage && <Badge>{e.stage}</Badge>}
    </>
  );
  switch (e.type) {
    case "tool":
      return (
        <li className={`ev ev-tool${e.isError ? " ev-err" : ""}`}>
          <details>
            <summary>
              {meta}
              <Wrench size={13} aria-hidden />
              <code>{e.name}</code>
              <span className="ev-args">{brief(e.input)}</span>
              {e.isError && <Badge tone="danger">error</Badge>}
            </summary>
            <div className="ev-detail">
              <div className="label">Input</div>
              <pre>{JSON.stringify(e.input, null, 2)}</pre>
              <div className="label">Result</div>
              <pre>{e.result}</pre>
            </div>
          </details>
        </li>
      );
    case "text":
      return (
        <li className="ev ev-text">
          {meta}
          <MessageSquareText size={13} aria-hidden />
          <p>{e.text}</p>
        </li>
      );
    case "search":
      return (
        <li className="ev">
          {meta}
          <Search size={13} aria-hidden />
          <span>
            Web search: <q>{e.query}</q>
          </span>
        </li>
      );
    case "turn":
      return (
        <li className="ev ev-turn">
          {meta}
          <span>
            Turn {e.turn} · {e.inputTokens.toLocaleString()} in / {e.outputTokens.toLocaleString()} out tokens
          </span>
        </li>
      );
    case "notice":
      return (
        <li className="ev ev-notice">
          {meta}
          <Info size={13} aria-hidden />
          <span>{e.message}</span>
        </li>
      );
    case "status":
      return (
        <li className="ev">
          {meta}
          <JobStatusBadge status={e.status} />
          {e.error && <span className="bad-text">{e.error}</span>}
        </li>
      );
  }
}

export function JobEvents({ events, follow }: { events: JobEvent[]; follow?: boolean }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (follow && el) el.scrollTop = el.scrollHeight;
  }, [events.length, follow]);
  if (!events.length) return <p className="muted">No events yet.</p>;
  return (
    <ol className="events" ref={ref} aria-label="Job events">
      {events.map((e, i) => (
        <EventRow key={i} e={e} />
      ))}
    </ol>
  );
}

/** Live view of one job: status, events and result. Refetches on job events. */
export function JobPanel({ jobId, version }: { jobId: string; version: number }) {
  const { data: job, error } = useResource<Job>(paths.job(jobId), version);
  const toast = useToast();
  if (error) return <ErrorBox error={error} />;
  if (!job) return <Loading what="job" />;
  const runs = job.kind === "verify" && Array.isArray(job.result) ? (job.result as VerificationRun[]) : null;
  const took = job.finishedAt ? fmtMs(new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) : null;
  return (
    <div className="job">
      <div className="job-head">
        <JobStatusBadge status={job.status} />
        <strong>{job.title}</strong>
        <span className="muted">
          {job.kind} · started {time(job.startedAt)}
          {took && ` · took ${took}`}
        </span>
        {job.status === "running" && (
          <button className="btn btn-sm" onClick={() => api.post(`${paths.job(job.id)}/cancel`).catch(toast.error)}>
            Cancel
          </button>
        )}
      </div>
      {job.error && <ErrorBox error={job.error} />}
      {runs && <VerifyRuns runs={runs} />}
      {job.result !== undefined && !runs && job.kind !== "verify" && (
        <details className="job-result">
          <summary>Result</summary>
          <pre>{JSON.stringify(job.result, null, 2)}</pre>
        </details>
      )}
      <JobEvents events={job.events} follow={job.status === "running"} />
    </div>
  );
}

export function JobDrawer({ jobId, version, onClose }: { jobId: string; version: number; onClose: () => void }) {
  return (
    <Drawer title="Job log" onClose={onClose}>
      <JobPanel jobId={jobId} version={version} />
    </Drawer>
  );
}
