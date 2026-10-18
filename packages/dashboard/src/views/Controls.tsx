import { useMemo, useState } from "react";
import { api, paths } from "../api";
import { Badge, Empty, Loading, Meter, Modal, SeverityBadge } from "../components/ui";
import { useShell, useToast } from "../context";
import { href, useResource } from "../hooks";
import { type ControlAssessment, type ControlStatus, type FrameworkDetail, type ScopeRow } from "../types";

const LABEL: Record<ControlStatus, string> = {
  gap: "gap",
  "needs-evidence": "needs evidence",
  "evidence-present": "evidence present",
  verified: "verified",
  attested: "attested",
};
const TONE: Record<ControlStatus, string> = { gap: "danger", "needs-evidence": "warn", "evidence-present": "neutral", verified: "teal", attested: "teal" };

export function Controls() {
  const shell = useShell();
  const { audit } = shell;
  const scope = useResource<ScopeRow[]>(paths.project(shell.pid, "/scope"), shell.version);
  if (audit === undefined || !scope.data) return <Loading what="controls" />;
  if (!audit) return <Empty title="No audit yet">Coverage appears after the first audit.</Empty>;
  const active = scope.data.filter((s) => s.active);
  return (
    <div className="stack">
      <p className="muted small">
        Coverage of the in-scope frameworks in audit {audit.id}. <em>Needs evidence</em> means nothing in the repository proved the control either way: attest it if it is covered outside the code.
      </p>
      {active.map((s) => (
        <FrameworkCoverage key={s.frameworkId} row={s} controls={audit.controls.filter((c) => c.controlId.startsWith(`${s.frameworkId}:`))} />
      ))}
    </div>
  );
}

function FrameworkCoverage({ row, controls }: { row: ScopeRow; controls: ControlAssessment[] }) {
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    const m: Record<ControlStatus, number> = { gap: 0, "needs-evidence": 0, "evidence-present": 0, verified: 0, attested: 0 };
    for (const c of controls) m[c.status]++;
    return m;
  }, [controls]);
  const ok = counts.verified + counts.attested + counts["evidence-present"];
  return (
    <details className="card coverage" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <strong>{row.shortTitle}</strong>
        <span className="muted small">{row.version}</span>
        <span className="grow" />
        <span className="cov-counts small">
          {(Object.keys(counts) as ControlStatus[]).filter((k) => counts[k]).map((k) => (
            <Badge key={k} tone={TONE[k]}>{counts[k]} {LABEL[k]}</Badge>
          ))}
        </span>
        <span className="cov-meter"><Meter value={ok} max={controls.length} label={`${row.shortTitle} coverage`} tone="teal" /></span>
      </summary>
      {open && <ControlTable frameworkId={row.frameworkId} controls={controls} />}
    </details>
  );
}

function ControlTable({ frameworkId, controls }: { frameworkId: string; controls: ControlAssessment[] }) {
  const shell = useShell();
  const toast = useToast();
  const { data } = useResource<FrameworkDetail>(paths.framework(frameworkId));
  const [attest, setAttest] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const byId = new Map(controls.map((c) => [c.controlId, c]));
  if (!data) return <Loading what="controls" />;
  const save = async () => {
    if (!attest || !shell.audit) return;
    try {
      await api.post(paths.audit(shell.pid, shell.audit.id, `/controls/${encodeURIComponent(attest)}`), { status: "attested", note });
      toast.success(`${attest} attested.`);
      setAttest(null);
      setNote("");
      shell.refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <table className="table">
        <thead><tr><th>Control</th><th>Severity</th><th>Status</th><th>Findings</th><th /></tr></thead>
        <tbody>
          {data.controls.filter((c) => byId.has(c.id)).map((c) => {
            const a = byId.get(c.id)!;
            return (
              <tr key={c.id}>
                <td><span className="mono small">{c.ref}</span> {c.title}{a.note && <div className="muted small">{a.note}</div>}</td>
                <td><SeverityBadge severity={c.severity} /></td>
                <td><Badge tone={TONE[a.status]}>{LABEL[a.status]}</Badge></td>
                <td className="small">{a.findingIds.map((id) => <a key={id} className="mono" href={href(shell.pid, "findings", id)}>{id} </a>)}</td>
                <td>{a.status !== "gap" && a.status !== "attested" && <button className="btn btn-sm" onClick={() => setAttest(c.id)}>Attest</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {attest && (
        <Modal
          title={`Attest ${attest}`}
          onClose={() => setAttest(null)}
          onSubmit={save}
          footer={<><button type="button" className="btn" onClick={() => setAttest(null)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={!note.trim()}>Attest</button></>}
        >
          <p className="muted">Record that this control is covered, for example by a document or process outside the repository. Your name and note go into the audit trail.</p>
          <label className="field">
            <span>Evidence *</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required data-autofocus placeholder="Where is the evidence? For example: TARA v2 in the safety repository, approved 2026-09-01." />
          </label>
        </Modal>
      )}
    </>
  );
}
