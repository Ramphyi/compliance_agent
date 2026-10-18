import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentEvent } from "@assay/core";

export type JobEvent = { at: string; stage?: string } & (AgentEvent | { type: "status"; status: Job["status"]; error?: string });

export type Job = {
  id: string;
  kind: "understand" | "investigate" | "reinvestigate" | "fix" | "fix-confirmed" | "research" | "verify";
  projectId: string;
  auditId?: string;
  findingId?: string;
  title: string;
  status: "running" | "done" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  events: JobEvent[];
  result?: unknown;
};

/** In-process background jobs for long agent runs, with events streamed to the dashboard. */
export class Jobs {
  readonly events = new EventEmitter();
  private jobs = new Map<string, Job>();
  private controllers = new Map<string, AbortController>();

  constructor() {
    this.events.setMaxListeners(200);
  }

  list(projectId?: string) {
    return [...this.jobs.values()]
      .filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 50)
      .map(({ events, ...j }) => ({ ...j, lastEvent: events.at(-1) }));
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  /** Only one agent job per project runs at a time; agents edit the same working tree. */
  running(projectId: string) {
    return [...this.jobs.values()].find((j) => j.projectId === projectId && j.status === "running");
  }

  start(
    meta: Omit<Job, "id" | "status" | "startedAt" | "events">,
    fn: (ctx: { signal: AbortSignal; emit: (e: AgentEvent & { stage?: string }) => void }) => Promise<unknown>,
  ): Job {
    const busy = this.running(meta.projectId);
    if (busy) throw new Error(`Another job is running for this project: ${busy.title}. Wait for it or cancel it.`);
    const job: Job = { ...meta, id: `job-${randomBytes(4).toString("hex")}`, status: "running", startedAt: new Date().toISOString(), events: [] };
    const ctrl = new AbortController();
    this.jobs.set(job.id, job);
    this.controllers.set(job.id, ctrl);
    const push = (e: JobEvent) => {
      job.events.push(e);
      if (job.events.length > 400) job.events.splice(0, job.events.length - 400);
      this.events.emit("job", { jobId: job.id, projectId: job.projectId, event: e });
    };
    push({ type: "status", status: "running", at: job.startedAt });
    fn({ signal: ctrl.signal, emit: (e) => push({ ...e, at: new Date().toISOString() }) })
      .then((result) => {
        job.result = result;
        job.status = ctrl.signal.aborted ? "cancelled" : "done";
      })
      .catch((e: Error) => {
        job.status = ctrl.signal.aborted ? "cancelled" : "failed";
        job.error = e.message;
      })
      .finally(() => {
        job.finishedAt = new Date().toISOString();
        this.controllers.delete(job.id);
        push({ type: "status", status: job.status, error: job.error, at: job.finishedAt });
      });
    return job;
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort();
  }
}
