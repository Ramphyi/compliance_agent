import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, ErrorBox, Loading, PageHeader, Spinner } from "../components/ui";
import { useToast } from "../context";
import { ago, go, href, useResource } from "../hooks";
import { type Meta, type ProjectListItem, SEVERITIES } from "../types";

export function ProviderLine({ meta }: { meta: Meta }) {
  return meta.provider ? (
    <p className="provider">
      Model <strong>{meta.provider.model}</strong> via {meta.provider.destination}. <a href="#/model">Change</a>
    </p>
  ) : (
    <p className="provider">
      {meta.providerError ? `Model unavailable: ${meta.providerError}.` : "No model: detectors only, or connect an agent over MCP."} <a href="#/model">Choose a model</a>
    </p>
  );
}

export function Projects({ meta }: { meta: Meta }) {
  const { data, error, reload } = useResource<ProjectListItem[]>("api/projects");
  const [adding, setAdding] = useState(false);
  const viewer = meta.account?.role === "viewer";
  // No event stream spans all projects; poll so running jobs and new audits show up.
  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div className="page">
      <PageHeader
        title="Projects"
        description={<ProviderLine meta={meta} />}
        actions={
          !viewer && (
            <button className="btn btn-primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
              Add project
            </button>
          )
        }
      />
      {adding && <AddProject clone={meta.cloneEnabled} onCancel={() => setAdding(false)} />}
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="projects" />
      ) : !data.length ? (
        <Empty title="No projects yet">
          Add a repository on this machine, or start the server with <code>acai serve &lt;path&gt;</code>.
        </Empty>
      ) : (
        <ul className="list" aria-label="Projects">
          {data.map((p) => (
            <li key={p.id}>
              <a className="list-row" href={href(p.id, "overview")}>
                <div className="list-main">
                  <span className="list-title">{p.name}</span>
                  <span className="mono muted small truncate" title={p.root}>
                    {p.root}
                  </span>
                  {p.classification && <span className="muted small clamp-1">{p.classification}</span>}
                </div>
                <div className="list-side">
                  {p.running ? (
                    <Spinner label={p.running} />
                  ) : p.latest ? (
                    <>
                      <span className="sev-counts" aria-label="Findings by severity">
                        {SEVERITIES.filter((s) => s !== "info").map((s) => {
                          const n = p.latest!.summary.bySeverity[s];
                          return (
                            <span key={s} className={`sev sev-${s}${n ? "" : " zero"}`} title={`${s}: ${n}`}>
                              <i aria-hidden />
                              {n}
                              <span className="sr-only"> {s}</span>
                            </span>
                          );
                        })}
                      </span>
                      <span className="nowrap">{p.latest.summary.open + p.latest.summary.reinvestigating} to review</span>
                      <span className="nowrap">{ago(p.latest.createdAt)}</span>
                    </>
                  ) : (
                    <span>No audit yet</span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      <footer className="registry-foot">
        {meta.registry ? (
          <>
            <span>
              Registry: {meta.registry.frameworks} frameworks, {meta.registry.controls} controls, {meta.registry.presets} presets
            </span>
            <span className="mono" title="Registry content hash, recorded with each audit">
              {meta.registry.hash}
            </span>
            {meta.registry.errors.length > 0 && (
              <details className="registry-errors">
                <summary className="bad-text">{meta.registry.errors.length} registry file(s) failed validation and were skipped</summary>
                <ul>
                  {meta.registry.errors.map((e, i) => (
                    <li key={i}>
                      <code>{e.file}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        ) : null}
        <span className="grow" />
        <span>Acai {meta.version}</span>
      </footer>
    </div>
  );
}

function AddProject({ clone, onCancel }: { clone: boolean; onCancel: () => void }) {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const p = await api.post<ProjectListItem>("api/projects", gitUrl ? { gitUrl, name: name || undefined } : { path, name: name || undefined });
      toast.success(`Added ${p.name}`);
      go(href(p.id, "overview"));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="card stack"
      style={{ marginBottom: 20 }}
      aria-label="Add a project"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field-row">
        <label className="field grow">
          <span>Path on the server</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/srv/repos/my-service" disabled={Boolean(gitUrl)} required={!gitUrl} className="mono" autoFocus />
        </label>
        <label className="field">
          <span>Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {clone && (
        <label className="field">
          <span>Or clone a git repository</span>
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://git.example.com/team/repo.git" className="mono" />
        </label>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy || (!path && !gitUrl)}>
          {busy ? <Spinner label={gitUrl ? "Cloning…" : "Adding…"} /> : "Add project"}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
