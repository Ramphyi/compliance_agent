import { type ReactNode, useState } from "react";
import { api, paths } from "../api";
import { useShell, useToast } from "../context";
import { categoryLabel, type Finding, type Fixability, REJECT_REASONS, type RejectReason, type ReviewAction, SEVERITIES, type Severity } from "../types";
import { Modal } from "./ui";

export type ReviewBody = {
  action: ReviewAction;
  note?: string;
  reason?: RejectReason;
  changes?: Partial<Pick<Finding, "title" | "severity" | "recommendation" | "fixInstructions" | "fixability">>;
  confirm?: boolean;
};

export const ACTION_LABELS: Record<ReviewAction, string> = {
  confirm: "Confirm",
  reject: "Reject",
  modify: "Modify",
  reinvestigate: "Re-investigate",
  reopen: "Reopen",
  resolve: "Resolve",
  "accept-fix": "Accept fix",
  "revert-fix": "Revert fix",
};

const REASON_LABELS: Record<RejectReason, string> = {
  "false-positive": "False positive",
  "accepted-risk": "Accepted risk",
  "not-applicable": "Not applicable",
  duplicate: "Duplicate",
  other: "Other",
};

type Pending = { action: "reject" | "modify" | "reinvestigate" | "resolve" | "revert-fix"; targets: Finding[] };

/**
 * Review actions for one or many findings. Actions that need input open a dialog; the
 * others run straight away. Findings whose state does not allow the action are skipped.
 */
export function useReviewFlow(onDone?: (updated: Finding[], action: ReviewAction) => void) {
  const shell = useShell();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (targets: Finding[], body: ReviewBody) => {
    const audit = shell.audit;
    if (!audit) return [];
    setBusy(true);
    const out: Finding[] = [];
    for (const f of targets) {
      try {
        const r = await api.post<{ finding: Finding; jobId?: string }>(paths.finding(shell.pid, audit.id, f.id, "/review"), body);
        shell.patchFinding(r.finding);
        out.push(r.finding);
        if (r.jobId) {
          shell.openJob(r.jobId);
          toast.info(`The agent is re-investigating ${f.id}.`);
        }
      } catch (e) {
        toast.error(e, targets.length > 1 ? `${f.id}: not updated` : undefined);
      }
    }
    setBusy(false);
    if (targets.length > 1) toast.success(`${ACTION_LABELS[body.action]}: ${out.length} of ${targets.length} findings updated.`);
    onDone?.(out, body.action);
    return out;
  };

  const act = (action: ReviewAction, findings: Finding[]) => {
    const targets = findings.filter((f) => f.actions.includes(action));
    const skipped = findings.length - targets.length;
    if (skipped) toast.info(`${skipped} finding(s) skipped: "${ACTION_LABELS[action]}" is not available in their current state.`);
    if (!targets.length || busy) return;
    if (action === "confirm" || action === "reopen" || action === "accept-fix") void run(targets, { action });
    else setPending({ action, targets });
  };

  const close = () => setPending(null);
  const submit = async (body: Omit<ReviewBody, "action"> & { action?: ReviewAction }) => {
    if (!pending) return;
    const out = await run(pending.targets, { action: pending.action, ...body } as ReviewBody);
    if (out.length) close();
  };

  let dialogs: ReactNode = null;
  if (pending) {
    const one = pending.targets.length === 1 ? pending.targets[0] : null;
    const label = one ? one.id : `${pending.targets.length} findings`;
    if (pending.action === "reject") dialogs = <RejectDialog label={label} busy={busy} onClose={close} onSubmit={(reason, note) => submit({ reason, note })} />;
    else if (pending.action === "modify" && one) dialogs = <ModifyDialog finding={one} busy={busy} onClose={close} onSubmit={(changes, confirm) => submit({ changes, confirm })} />;
    else if (pending.action === "reinvestigate")
      dialogs = (
        <NoteDialog
          title={`Re-investigate ${label}`}
          intro={
            shell.meta.provider
              ? "The agent looks again with your note and keeps, revises or withdraws the finding."
              : "No model here. A connected agent such as Claude Code picks this up with your note."
          }
          label="What should the agent look at?"
          required
          submitLabel="Re-investigate"
          busy={busy}
          onClose={close}
          onSubmit={(note) => submit({ note })}
        />
      );
    else if (pending.action === "resolve")
      dialogs = (
        <NoteDialog
          title={`Resolve ${label}`}
          intro="For example, because it was fixed outside Acai."
          label="How was it resolved?"
          submitLabel="Resolve"
          busy={busy}
          onClose={close}
          onSubmit={(note) => submit({ note })}
        />
      );
    else if (pending.action === "revert-fix")
      dialogs = (
        <NoteDialog
          title={`Revert fix for ${label}`}
          intro={`Reverts ${one?.fix?.commit ? `commit ${one.fix.commit.slice(0, 10)}` : "the fix commit"}${one?.fix?.branch ? ` on ${one.fix.branch}` : ""}. The finding goes back to Confirmed.`}
          label="Note (optional)"
          submitLabel="Revert fix"
          danger
          busy={busy}
          onClose={close}
          onSubmit={(note) => submit({ note })}
        />
      );
  }

  return { act, run, dialogs, busy, openModify: (f: Finding) => setPending({ action: "modify", targets: [f] }) };
}

function RejectDialog(props: { label: string; busy: boolean; onClose: () => void; onSubmit: (r: RejectReason, note: string) => void }) {
  const [reason, setReason] = useState<RejectReason>("false-positive");
  const [note, setNote] = useState("");
  return (
    <Modal
      title={`Reject ${props.label}`}
      onClose={props.onClose}
      onSubmit={() => props.onSubmit(reason, note.trim())}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-danger" disabled={props.busy}>
            Reject
          </button>
        </>
      }
    >
      <label className="field">
        <span>Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as RejectReason)} data-autofocus>
          {REJECT_REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Note</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded in the audit trail" />
      </label>
    </Modal>
  );
}

function ModifyDialog(props: { finding: Finding; busy: boolean; onClose: () => void; onSubmit: (changes: ReviewBody["changes"], confirm: boolean) => void }) {
  const f = props.finding;
  const [v, setV] = useState({
    title: f.title,
    severity: f.severity,
    recommendation: f.recommendation,
    fixInstructions: f.fixInstructions ?? "",
    fixability: f.fixability,
  });
  const changes = Object.fromEntries(
    Object.entries(v).filter(([k, x]) => x !== ((f as Record<string, unknown>)[k] ?? (k === "fixInstructions" ? "" : undefined))),
  ) as ReviewBody["changes"];
  const changed = Object.keys(changes ?? {}).length > 0;
  const canConfirm = f.status !== "confirmed";
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Modal
      wide
      title={`Modify ${f.id}`}
      onClose={props.onClose}
      onSubmit={() => changed && props.onSubmit(changes, false)}
      footer={
        <>
          <span className="muted small grow">{changed ? `${Object.keys(changes!).length} field(s) changed` : "No changes"}</span>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!changed || props.busy}>
            Save
          </button>
          {canConfirm && (
            <button type="button" className="btn btn-primary" disabled={props.busy} onClick={() => props.onSubmit(changes, true)}>
              Save &amp; confirm
            </button>
          )}
        </>
      }
    >
      <label className="field">
        <span>Title</span>
        <input value={v.title} onChange={set("title")} required data-autofocus />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Severity</span>
          <select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fixability</span>
          <select value={v.fixability} onChange={(e) => setV({ ...v, fixability: e.target.value as Fixability })}>
            <option value="code">Code</option>
            <option value="document">Document</option>
            <option value="process">Process (needs a person)</option>
          </select>
        </label>
        <div className="field">
          <span>Category</span>
          <div className="static-field">{categoryLabel(f.category)}</div>
        </div>
      </div>
      <label className="field">
        <span>Recommendation</span>
        <textarea rows={4} value={v.recommendation} onChange={set("recommendation")} />
      </label>
      <label className="field">
        <span>Fix instructions for the agent</span>
        <textarea
          rows={4}
          value={v.fixInstructions}
          onChange={set("fixInstructions")}
          placeholder="e.g. Use the config loader in src/config.js. No new dependencies."
        />
      </label>
    </Modal>
  );
}

function NoteDialog(props: {
  title: string;
  intro: string;
  label: string;
  required?: boolean;
  danger?: boolean;
  submitLabel: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const ok = !props.required || note.trim().length > 0;
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      onSubmit={() => ok && props.onSubmit(note.trim())}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className={props.danger ? "btn btn-danger" : "btn btn-primary"} disabled={!ok || props.busy}>
            {props.submitLabel}
          </button>
        </>
      }
    >
      <p className="muted">{props.intro}</p>
      <label className="field">
        <span>
          {props.label}
          {props.required && <span aria-hidden> *</span>}
        </span>
        <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} required={props.required} data-autofocus />
      </label>
    </Modal>
  );
}
