import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, paths } from "../api";
import { JobDrawer } from "../components/JobLog";
import { ErrorBox, Loading, Spinner } from "../components/ui";
import { type Shell, ShellCtx, useToast } from "../context";
import { href, type Route, type Tab, useResource } from "../hooks";
import type { Audit, AuditListItem, Finding, JobListItem, Meta, Profile } from "../types";
import { Activity as ActivityView } from "./Activity";
import { Controls } from "./Controls";
import { Findings } from "./Findings";
import { Fixes } from "./Fixes";
import { Overview } from "./Overview";
import { ProfileView } from "./Profile";
import { Research } from "./Research";
import { Scope } from "./Scope";
import { SettingsView } from "./Settings";

const TAB_LABELS: Record<Tab, string> = {
  overview: "Overview",
  profile: "Profile",
  scope: "Scope",
  findings: "Findings",
  fixes: "Fixes",
  controls: "Controls",
  research: "Research",
  activity: "Activity",
  settings: "Settings",
};

export function ProjectShell({ meta, route }: { meta: Meta; route: Extract<Route, { page: "project" }> }) {
  const pid = route.pid;
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [jobVersion, setJobVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [jobOpen, setJobOpen] = useState<string | null>(null);
  const [patched, setPatched] = useState<Record<string, Finding>>({});

  const profile = useResource<Profile>(paths.project(pid, "/profile"), version);
  const audits = useResource<AuditListItem[]>(paths.project(pid, "/audits"), version);
  const auditId = selected ?? audits.data?.[0]?.id ?? null;
  const auditRes = useResource<Audit>(auditId ? paths.audit(pid, auditId) : null, version);
  const jobs = useResource<JobListItem[]>(paths.jobs(pid), jobVersion);

  // Fresh data replaces optimistic patches.
  useEffect(() => setPatched({}), [auditRes.data]);

  const audit: Audit | null | undefined = useMemo(() => {
    if (!auditId) return audits.data ? null : undefined;
    const a = auditRes.data;
    if (!a) return undefined;
    if (!Object.keys(patched).length) return a;
    return { ...a, findings: a.findings.map((f) => patched[f.id] ?? f) };
  }, [auditId, audits.data, auditRes.data, patched]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Live updates: store changes refetch (debounced), job events refresh jobs and toast completions.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(paths.events(pid));
    } catch {
      return;
    }
    const bump = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVersion((v) => v + 1), 400);
    };
    es.addEventListener("change", bump);
    es.addEventListener("job", (ev) => {
      setJobVersion((v) => v + 1);
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { event?: { type: string; status?: string; error?: string } };
        const e = data.event;
        if (e?.type === "status" && e.status !== "running") {
          if (e.status === "failed") toast.error(e.error ?? "The job failed.", "Job failed");
          else if (e.status === "done") toast.success("Job finished.");
          bump();
        }
      } catch {
        /* ignore malformed events */
      }
    });
    return () => {
      clearTimeout(timer.current);
      es?.close();
    };
  }, [pid, toast]);

  const startJob = useCallback(
    async (path: string, body: unknown = {}) => {
      try {
        const r = await api.post<{ id?: string; jobId?: string }>(path, body);
        const id = r.jobId ?? r.id;
        if (id) {
          setJobOpen(id);
          setJobVersion((v) => v + 1);
        }
        refresh();
        return id;
      } catch (e) {
        toast.error(e);
        return undefined;
      }
    },
    [refresh, toast],
  );

  const running = jobs.data?.find((j) => j.status === "running");
  const shell: Shell = {
    pid,
    meta,
    profile: profile.data,
    audits: audits.data,
    audit,
    selectAudit: setSelected,
    patchFinding: (f) => setPatched((p) => ({ ...p, [f.id]: f })),
    version,
    jobVersion,
    jobs: jobs.data ?? [],
    running,
    openJob: setJobOpen,
    startJob,
    refresh,
  };

  const needs = audit ? audit.findings.filter((f) => f.status === "open" || f.status === "reinvestigating").length : 0;
  const fixes = audit ? audit.findings.filter((f) => ["fixing", "fix_ready", "fix_failed"].includes(f.status)).length : 0;
  const counts: Partial<Record<Tab, number>> = { findings: needs, fixes };

  let body: ReactNode;
  if (profile.error && !profile.data) body = <ErrorBox error={profile.error} retry={profile.reload} />;
  else if (!profile.data) body = <Loading what="project" />;
  else {
    switch (route.tab) {
      case "profile": body = <ProfileView />; break;
      case "scope": body = <Scope />; break;
      case "findings": body = <Findings selectedId={route.id} />; break;
      case "fixes": body = <Fixes />; break;
      case "controls": body = <Controls />; break;
      case "research": body = <Research />; break;
      case "activity": body = <ActivityView />; break;
      case "settings": body = <SettingsView />; break;
      default: body = <Overview />;
    }
  }

  return (
    <ShellCtx.Provider value={shell}>
      <div className="project">
        <div className="project-top">
          <header className="project-head">
            <div className="project-title">
              <a href="#/" className="crumb">
                Projects
              </a>
              <span aria-hidden className="muted">
                /
              </span>
              <h1>{profile.data?.name ?? "…"}</h1>
              {profile.data && (
                <span className="mono muted truncate project-root" title={profile.data.root}>
                  {profile.data.root}
                </span>
              )}
            </div>
            <span className="grow" />
            {running && (
              <button className="btn btn-sm running-btn" onClick={() => setJobOpen(running.id)} title="Open the job log">
                <Spinner label={running.title} />
              </button>
            )}
            {audit && (
              <div className="export" role="group" aria-label="Export report">
                <span className="label">Export</span>
                {(["md", "json", "sarif"] as const).map((f) => (
                  <a key={f} className="btn btn-sm btn-ghost" href={paths.audit(pid, audit.id, `/report?format=${f}`)} download>
                    {f.toUpperCase()}
                  </a>
                ))}
              </div>
            )}
          </header>
          <nav className="tabs" aria-label="Project sections">
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <a key={t} href={href(pid, t)} className="tab" aria-current={route.tab === t ? "page" : undefined}>
                {TAB_LABELS[t]}
                {counts[t] ? (
                  <span className="tab-count" aria-label={`${counts[t]} ${t === "findings" ? "to review" : "in progress"}`}>
                    {counts[t]}
                  </span>
                ) : null}
              </a>
            ))}
          </nav>
        </div>
        <div className="project-body">{body}</div>
      </div>
      {jobOpen && <JobDrawer jobId={jobOpen} version={jobVersion} onClose={() => setJobOpen(null)} />}
    </ShellCtx.Provider>
  );
}
