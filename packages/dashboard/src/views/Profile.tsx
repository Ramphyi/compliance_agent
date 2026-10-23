import { useEffect, useMemo, useState } from "react";
import { api, paths } from "../api";
import { Badge, Meter, SectionHead, Segmented, Spinner } from "../components/ui";
import { useShell, useToast } from "../context";
import { loc } from "../hooks";
import type { AnswerValue, Question } from "../types";

export function ProfileView() {
  const shell = useShell();
  const toast = useToast();
  const p = shell.profile!;
  const [purpose, setPurpose] = useState(p.classification?.purpose ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setPurpose(p.classification?.purpose ?? ""), [p.classification?.purpose]);

  const call = async (key: string, path: string, body: unknown, ok?: string) => {
    setBusy(key);
    try {
      await api.post(paths.project(shell.pid, path), body);
      if (ok) toast.success(ok);
      shell.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const sections = useMemo(() => {
    const m = new Map<string, Question[]>();
    for (const q of p.questions) m.set(q.section, [...(m.get(q.section) ?? []), q]);
    return [...m];
  }, [p.questions]);
  const c = p.completeness;
  const viewer = shell.meta.account?.role === "viewer";

  return (
    <fieldset disabled={viewer}>
      <section className="section" aria-labelledby="purpose-h">
        <SectionHead
          id="purpose-h"
          title="Purpose"
          description={p.classification?.summary ?? "Not scanned yet."}
          actions={
            <button className="btn btn-sm" onClick={() => call("scan", "/scan", {}, "Repository rescanned.")} disabled={busy !== null}>
              {busy === "scan" ? <Spinner label="Scanning…" /> : "Rescan code"}
            </button>
          }
        />
        <label className="field">
          <span>
            What the product is for <span className="hint">· who uses it, where it runs, what data it handles, safety relevance</span>
          </span>
          <textarea rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Firmware for a consumer smart thermostat sold in the EU and UK. Wi-Fi and BLE, OTA updates, no safety function." />
        </label>
        <div className="form-actions" style={{ marginTop: 8 }}>
          <button className="btn" disabled={busy !== null || purpose === (p.classification?.purpose ?? "")} onClick={() => call("purpose", "/purpose", { purpose }, "Purpose saved.")}>
            Save purpose
          </button>
        </div>
      </section>

      <section className="section" aria-labelledby="questions-h">
        <div className="section-head">
          <h2 id="questions-h" className="grow">
            Compliance questions
          </h2>
          <label className="inline-field">
            <span className="muted small">Preset</span>
            <select
              value=""
              onChange={(e) => e.target.value && call("preset", "/preset", { presetId: e.target.value }, "Preset applied. Review the answers.")}
              disabled={busy !== null}
            >
              <option value="">{p.presetId ? `Current: ${p.presetId}` : "Choose…"}</option>
              {p.presets.map((x) => (
                <option key={x.id} value={x.id} title={x.description}>{x.title}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary btn-sm" disabled={busy !== null || !c.unconfirmed.length} onClick={() => call("all", "/answers/confirm", { ids: "all" }, "All answers confirmed.")}>
            Confirm all
          </button>
        </div>
        <div className="completeness">
          <Meter value={c.confirmed} max={c.total} label="Confirmed answers" />
          <span className="muted small">{c.confirmed} of {c.total} confirmed · {c.answered} answered</span>
        </div>
        {c.missingForScope.length > 0 && (
          <p className="callout callout-warn"><span>Needed to decide the scope: <strong>{c.missingForScope.join(", ")}</strong></span></p>
        )}
        {sections.map(([section, qs]) => (
          <fieldset key={section} className="q-section">
            <legend>{section}</legend>
            {qs.map((q) => <QuestionRow key={q.id} q={q} busy={busy !== null} onSave={(v) => call(q.id, "/answers", { values: { [q.id]: v }, confirm: true }, "Answer saved.")} onConfirm={() => call(q.id, "/answers/confirm", { ids: [q.id] })} />)}
          </fieldset>
        ))}
      </section>
    </fieldset>
  );
}

const asList = (v?: AnswerValue) => (v === undefined ? [] : Array.isArray(v) ? v : [String(v)]);

function QuestionRow({ q, busy, onSave, onConfirm }: { q: Question; busy: boolean; onSave: (v: AnswerValue) => void; onConfirm: () => void }) {
  const current = asList(q.answer?.value);
  const [draft, setDraft] = useState<string[]>(current);
  useEffect(() => setDraft(asList(q.answer?.value)), [q.answer?.value]);
  const dirty = draft.join("|") !== current.join("|");
  const a = q.answer;
  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  return (
    <div className={`q${a && !a.confirmed ? " q-unconfirmed" : ""}`}>
      <div className="q-head">
        <div>
          <div className="q-text">{q.text} <span className="mono muted small">{q.id}</span></div>
          <div className="muted small">{q.why}</div>
        </div>
        <span className="grow" />
        {a && (a.confirmed ? <span className="muted small">Confirmed</span> : <Badge tone="warn">Unconfirmed · {a.source}</Badge>)}
      </div>
      {q.type === "single" && q.options ? (
        <Segmented label={q.text} value={draft[0]} options={q.options.map((o) => ({ value: o.value, label: o.label, title: o.value }))} onChange={(v) => setDraft([v])} disabled={busy} />
      ) : q.options ? (
        <div className="chips" role="group" aria-label={q.text}>
          {q.options.map((o) => (
            <button key={o.value} type="button" className="chip" aria-pressed={draft.includes(o.value)} onClick={() => toggle(o.value)} disabled={busy} title={o.value}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {a?.rationale && (
        <div className="muted small">
          Why: {a.rationale}
          {a.refs?.length ? <span className="mono"> ({a.refs.slice(0, 3).map(loc).join(", ")})</span> : null}
        </div>
      )}
      {(dirty || (a && !a.confirmed)) && (
        <div className="row">
          {dirty && (
            <button className="btn btn-sm btn-primary" disabled={busy || !draft.length} onClick={() => onSave(q.type === "multi" ? draft : draft[0])}>
              Save answer
            </button>
          )}
          {dirty && <button className="btn btn-sm" onClick={() => setDraft(current)}>Undo</button>}
          {!dirty && a && !a.confirmed && <button className="btn btn-sm" disabled={busy} onClick={onConfirm}>Confirm</button>}
        </div>
      )}
    </div>
  );
}
