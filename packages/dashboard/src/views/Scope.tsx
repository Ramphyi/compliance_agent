import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { api, paths } from "../api";
import { Badge, Drawer, ErrorBox, Loading, SeverityBadge, Segmented } from "../components/ui";
import { useShell, useToast } from "../context";
import { useResource } from "../hooks";
import type { FrameworkDetail, ScopeRow } from "../types";

export function Scope() {
  const shell = useShell();
  const toast = useToast();
  const { data, error, reload } = useResource<ScopeRow[]>(paths.project(shell.pid, "/scope"), shell.version);
  const [filter, setFilter] = useState<"active" | "undecided" | "all">("active");
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading what="scope" />;
  const rows = data.filter((r) => (filter === "all" ? true : filter === "active" ? r.active : r.status === "unknown" && !r.override));

  const override = async (id: string, value: "include" | "exclude" | null) => {
    try {
      await api.post(paths.project(shell.pid, `/scope/${encodeURIComponent(id)}`), { value });
      shell.refresh();
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Frameworks</h2>
        <span className="muted small">
          {data.filter((r) => r.active).length} in scope · {data.filter((r) => r.status === "unknown" && !r.override).length} undecided · {data.length} in the registry
        </span>
        <span className="grow" />
        <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "active", label: "In scope" }, { value: "undecided", label: "Undecided" }, { value: "all", label: "All" }]} />
      </div>
      <table className="table">
        <thead>
          <tr><th>Framework</th><th>Version</th><th>Kind</th><th>Status</th><th>Controls</th><th>Override</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.frameworkId} className={r.active ? "" : "dim"}>
              <td>
                <button className="link-btn strong" onClick={() => setOpen(r.frameworkId)}>{r.shortTitle}</button>
                <div className="muted small clamp-1" title={r.title}>{r.title}</div>
              </td>
              <td className="small">{r.version}</td>
              <td><Badge>{r.kind}</Badge></td>
              <td>
                {r.status === "applies" && <Badge tone="teal">applies</Badge>}
                {r.status === "not-applicable" && <Badge>not applicable</Badge>}
                {r.status === "unknown" && <Badge tone="warn" title={`Needs: ${r.missingFacts.join(", ")}`}>undecided · {r.missingFacts.join(", ")}</Badge>}
                {r.unconfirmedFacts.length > 0 && r.status !== "unknown" && <div className="muted small">relies on unconfirmed: {r.unconfirmedFacts.join(", ")}</div>}
              </td>
              <td className="num">{r.controls}</td>
              <td>
                <Segmented
                  label={`Override for ${r.shortTitle}`}
                  value={r.override ?? "auto"}
                  onChange={(v) => override(r.frameworkId, v === "auto" ? null : v)}
                  options={[{ value: "auto", label: "Auto" }, { value: "include", label: "Include" }, { value: "exclude", label: "Exclude" }]}
                />
              </td>
              <td>
                <a className="icon-btn" href={r.url} target="_blank" rel="noreferrer" aria-label={`Official page of ${r.shortTitle}`} title="Official source">
                  <ExternalLink size={14} />
                </a>
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={7} className="muted">Nothing here.</td></tr>
          )}
        </tbody>
      </table>
      {open && <FrameworkDrawer id={open} row={data.find((r) => r.frameworkId === open)} onClose={() => setOpen(null)} />}
    </section>
  );
}

function FrameworkDrawer({ id, row, onClose }: { id: string; row?: ScopeRow; onClose: () => void }) {
  const { data, error } = useResource<FrameworkDetail>(paths.framework(id));
  return (
    <Drawer title={data?.shortTitle ?? row?.shortTitle ?? id} onClose={onClose}>
      {error && <ErrorBox error={error} />}
      {!data ? (
        !error && <Loading what="framework" />
      ) : (
        <div className="stack">
          <p className="lead">{data.title}</p>
          <p className="muted small">{data.authority} · {data.version} · {data.jurisdictions.join(", ")} · <a href={data.url} target="_blank" rel="noreferrer">official source</a></p>
          <p>{data.summary}</p>
          <h3>When it applies</h3>
          <p>{data.applicabilityNote}</p>
          {row && <p className="muted small">For this project: <strong>{row.status}</strong>{row.override ? ` (manually ${row.override}d)` : ""}. {row.status === "unknown" ? `Needs: ${row.missingFacts.join(", ")}.` : ""}</p>}
          {data.keyDates.length > 0 && (
            <>
              <h3>Key dates</h3>
              <ul className="dates">
                {data.keyDates.map((d) => <li key={d.date + d.note}><span className="mono">{d.date}</span> {d.note}</li>)}
              </ul>
            </>
          )}
          <h3>{data.controls.length} controls</h3>
          <ul className="control-list">
            {data.controls.map((c) => (
              <li key={c.id}>
                <details>
                  <summary>
                    <SeverityBadge severity={c.severity} /> <span className="mono small">{c.ref}</span> {c.title}
                  </summary>
                  <p>{c.requirement}</p>
                  <p className="muted small"><strong>What to check:</strong> {c.guidance}</p>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}
