import { Cpu, FolderGit2, FolderPlus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Empty, ErrorBox, Loading, Spinner } from "../components/ui";
import { useToast } from "../context";
import { ago, go, href, useResource } from "../hooks";
import { type Meta, type ProjectListItem, SEVERITIES } from "../types";

export function ProviderLine({ meta }: { meta: Meta }) {
  return meta.provider ? (
    <p className="provider">
      <Cpu size={14} aria-hidden /> Model <strong>{meta.provider.model}</strong> <span className="muted">sends prompts to</span> {meta.provider.destination}
    </p>
  ) : (
    <p className="provider muted">
      <Cpu size={14} aria-hidden /> No model configured: detectors only; use an MCP host for reasoning.
    </p>
  );
}

export function Projects({ meta }: { meta: Meta }) {
  const { data, error, reload } = useResource<ProjectListItem[]>("api/projects");
  const [adding, setAdding] = useState(false);
  // No event stream spans all projects; poll so running jobs and new audits show up.
  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="grow" />
        <button className="btn btn-primary" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          <Plus size={14} aria-hidden /> Add project
        </button>
      </div>
      <ProviderLine meta={meta} />
      {adding && <AddProject clone={meta.cloneEnabled} onCancel={() => setAdding(false)} />}
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        !error && <Loading what="projects" />
      ) : !data.length ? (
        <Empty icon={<FolderPlus size={28} />} title="No projects yet">
          Add a repository on this machine, or start the server with <code>assay serve &lt;path&gt;</code>.
        </Empty>
      ) : (
        <div className="cards">
          {data.map((p) => (
            <a key={p.id} className="card project-card" href={href(p.id, "overview")}>
              <h2>{p.name}</h2>
              <div className="mono muted truncate" title={p.root}>
                {p.root}
              </div>
              {p.classification && <p className="clamp">{p.classification}</p>}
              {p.latest ? (
                <div className="project-latest">
                  <div className="sev-counts" aria-label="Open findings by severity">
                    {SEVERITIES.map((s) => (
                      <span key={s} className={`sev sev-${s}`} title={`${s}: ${p.latest!.summary.bySeverity[s]}`}>
                        <i aria-hidden />
                        {p.latest!.summary.bySeverity[s]}
                        <span className="sr-only"> {s}</span>
                      </span>
                    ))}
                  </div>
                  <span className="muted">
                    {p.latest.summary.total} findings · {p.latest.summary.open + p.latest.summary.reinvestigating} need a decision · {ago(p.latest.createdAt)}
                  </span>
                </div>
              ) : (
                <p className="muted">No audit yet</p>
              )}
              {p.running && (
                <div className="running-line">
                  <Spinner label={`Running: ${p.running}`} />
                </div>
              )}
            </a>
          ))}
        </div>
      )}
      <footer className="registry-foot">
        {meta.registry ? (
          <>
            Registry {meta.registry.frameworks} frameworks · {meta.registry.controls} controls · {meta.registry.presets} presets ·{" "}
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
        ) : (
          "Registry statistics appear once a project is added."
        )}
        <span className="grow" />
        Assay {meta.version}
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
      className="card add-project"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>
        <FolderGit2 size={16} aria-hidden /> Add a project
      </h2>
      <div className="field-row">
        <label className="field grow">
          <span>Path on the server</span>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/srv/repos/my-service" disabled={Boolean(gitUrl)} required={!gitUrl} className="mono" />
        </label>
        <label className="field">
          <span>Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {clone && (
        <label className="field">
          <span>…or clone a git repository</span>
          <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://git.example.com/team/repo.git" className="mono" />
        </label>
      )}
      <div className="row">
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
