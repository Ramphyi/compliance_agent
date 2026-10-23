import { Search, TriangleAlert, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, paths } from "../api";
import { ConfirmDialog, ErrorBox, Loading, Modal, SectionHead } from "../components/ui";
import { useToast } from "../context";
import { useResource } from "../hooks";
import { type FrameworkCheck, frameworkKindLabel, type ServerFramework, type ServerFrameworks } from "../types";

type Editing = { yaml: string; base?: ServerFramework };

/**
 * Admin → Frameworks: the built-in registry plus this server's own frameworks. A file with a
 * built-in id replaces it for every project (a newer ISO revision, a company profile of a
 * standard); removing that file brings the built-in version back.
 */
export function Frameworks() {
  const toast = useToast();
  const { data, error, reload } = useResource<ServerFrameworks>("api/admin/frameworks");
  const [show, setShow] = useState<"all" | "server">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [removing, setRemoving] = useState<ServerFramework | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.frameworks ?? [])
      .filter((f) => show === "all" || f.origin === "custom")
      .filter((f) => !needle || `${f.id} ${f.shortTitle} ${f.title} ${f.authority} ${f.version}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.origin === "custom") - Number(a.origin === "custom") || a.shortTitle.localeCompare(b.shortTitle));
  }, [data, show, q]);
  const own = data?.frameworks.filter((f) => f.origin === "custom").length ?? 0;

  const open = async (base?: ServerFramework) => {
    try {
      const { yaml } = base ? await api.get<{ yaml: string }>(paths.adminFramework(base.id, "/source")) : await api.get<{ yaml: string }>("api/admin/frameworks/template");
      setEditing({ yaml, base });
    } catch (e) {
      toast.error(e);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      const r = await api.del<{ restored?: { version: string } }>(paths.adminFramework(removing.id));
      toast.success(r.restored ? `Removed. ${removing.shortTitle} is back to the built-in ${r.restored.version}.` : `Removed ${removing.shortTitle}.`);
      setRemoving(null);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="fw-h">
      <SectionHead
        id="fw-h"
        title={data ? `${data.frameworks.length} frameworks` : "Frameworks"}
        description={
          <>
            Add a standard that is not built in, an internal company standard, or a newer revision of a built-in one (keep its id). It applies to every project on this
            server at once; re-audit to check against it.{data && <> Stored in <span className="mono">{data.dir}</span>.</>}
          </>
        }
        actions={
          data?.writable && (
            <>
              <input
                ref={upload}
                type="file"
                accept=".yaml,.yml,text/yaml"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) setEditing({ yaml: await file.text() });
                }}
              />
              <button className="btn btn-sm" onClick={() => upload.current?.click()}>
                <Upload size={14} aria-hidden /> Upload YAML
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => open()}>
                New framework
              </button>
            </>
          )
        }
      />
      {error && <ErrorBox error={error} retry={reload} />}
      {data && !data.writable && (
        <div className="callout callout-warn">
          <TriangleAlert size={16} aria-hidden />
          <span>
            The frameworks directory is read-only here. Change the files in <span className="mono">{data.dir}</span> (for example in the git repository it is mounted from); the
            server picks them up without a restart.
          </span>
        </div>
      )}
      {data && data.errors.length > 0 && (
        <div className="callout callout-error" role="alert">
          <TriangleAlert size={16} aria-hidden />
          <div>
            <strong>Skipped because they are not valid</strong> (the previous or built-in version applies):
            <ul className="small">
              {data.errors.map((e, i) => (
                <li key={i}>
                  <span className="mono">{e.file.split("/").pop()}</span>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!data ? (
        !error && <Loading what="frameworks" />
      ) : (
        <>
          <div className="fw-toolbar">
            <div className="seg" role="group" aria-label="Show">
              <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>
                All <span className="count">{data.frameworks.length}</span>
              </button>
              <button type="button" aria-pressed={show === "server"} onClick={() => setShow("server")}>
                Added on this server <span className="count">{own}</span>
              </button>
            </div>
            <label className="search">
              <Search size={14} aria-hidden />
              <input type="search" placeholder="Search frameworks" aria-label="Search frameworks" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          </div>
          {!list.length ? (
            <p className="muted">{show === "server" ? "No frameworks added on this server yet." : "No frameworks match."}</p>
          ) : (
            <div className="table-wrap">
              <table className="table middle">
                <thead>
                  <tr>
                    <th>Framework</th>
                    <th>Kind</th>
                    <th>Version</th>
                    <th>Controls</th>
                    <th>Source</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <span className="strong">{f.shortTitle}</span>
                        <div className="muted small clamp-1" title={f.title}>
                          <span className="mono">{f.id}</span> · {f.authority}
                        </div>
                      </td>
                      <td className="small">{frameworkKindLabel(f.kind)}</td>
                      <td className="small">{f.version}</td>
                      <td className="small">{f.controls}</td>
                      <td>
                        <OriginBadge f={f} />
                      </td>
                      <td className="actions-cell">
                        {data.writable && (
                          <>
                            <button className="btn btn-sm" onClick={() => open(f)} aria-label={`${f.origin === "custom" ? "Edit" : "Update"} ${f.shortTitle}`}>
                              {f.origin === "custom" ? "Edit" : "Update"}
                            </button>
                            {f.origin === "custom" && (
                              <button className="btn btn-sm btn-danger" onClick={() => setRemoving(f)} aria-label={`${f.replaces ? "Revert" : "Remove"} ${f.shortTitle}`}>
                                {f.replaces ? "Revert" : "Remove"}
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && (
        <Editor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(check) => {
            const f = check.framework!;
            toast.success(`${check.replaces ? "Updated" : "Added"} ${f.shortTitle} (${f.version}). Re-audit projects to check against it.`);
            setEditing(null);
            reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={removing.replaces ? `Revert ${removing.shortTitle}` : `Remove ${removing.shortTitle}`}
          confirmLabel={removing.replaces ? "Revert to built-in" : "Remove"}
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        >
          <p>
            {removing.replaces ? (
              <>
                Projects go back to the built-in <strong>{removing.replaces.version}</strong>.
              </>
            ) : (
              <>Projects stop checking against it.</>
            )}{" "}
            Findings of earlier audits stay as they are; the next audit uses the change.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

function OriginBadge({ f }: { f: ServerFramework }) {
  if (f.origin === "built-in") return <span className="row-note">Built-in</span>;
  if (f.replaces) return <span className="badge badge-accent" title={`Replaces the ${f.replaces.origin} version ${f.replaces.version}`}>Updated on this server</span>;
  return <span className="badge badge-accent">Added on this server</span>;
}

/** YAML editor: check first, then save the exact text that was checked. */
function Editor({ initial, onClose, onSaved }: { initial: Editing; onClose: () => void; onSaved: (c: FrameworkCheck) => void }) {
  const toast = useToast();
  const [yaml, setYaml] = useState(initial.yaml);
  const [check, setCheck] = useState<{ yaml: string; result: FrameworkCheck } | null>(null);
  const [busy, setBusy] = useState(false);
  const checked = check?.yaml === yaml ? check.result : null;

  const validate = async () => {
    setBusy(true);
    try {
      setCheck({ yaml, result: await api.post<FrameworkCheck>("api/admin/frameworks/validate", { yaml }) });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.post<FrameworkCheck>("api/admin/frameworks", { yaml }));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const title = initial.base ? `${initial.base.origin === "custom" ? "Edit" : "Update"} ${initial.base.shortTitle}` : "New framework";
  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">
            {initial.base?.origin === "built-in" ? "Keep the id to replace the built-in version; the shipped file is not changed." : "Paraphrase licensed standards and keep the clause numbers."}
          </span>
          <button className="btn" onClick={validate} disabled={busy || !yaml.trim()}>
            Check
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !checked?.ok}>
            {checked?.replaces ? "Save update" : "Save"}
          </button>
        </>
      }
    >
      <textarea
        className="mono fw-yaml"
        aria-label="Framework YAML"
        spellCheck={false}
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        rows={22}
      />
      {checked ? (
        <div className={`callout ${checked.ok ? "callout-ok" : "callout-error"}`} role="status">
          <div>
            {checked.framework && (
              <p>
                <strong>{checked.framework.shortTitle}</strong> · {checked.framework.version} · {frameworkKindLabel(checked.framework.kind)} · {checked.framework.controls}{" "}
                {checked.framework.controls === 1 ? "control" : "controls"}
                {checked.replaces && (
                  <>
                    {" "}
                    · replaces the {checked.replaces.origin} version <em>{checked.replaces.version}</em>
                  </>
                )}
              </p>
            )}
            {checked.ok && !checked.warnings.length && <p>Valid. Save to apply it to every project.</p>}
            {checked.errors.length > 0 && (
              <ul className="small">
                {checked.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {checked.warnings.length > 0 && (
              <ul className="small muted">
                {checked.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="small muted">Check the file to see what it adds or replaces before saving.</p>
      )}
    </Modal>
  );
}
