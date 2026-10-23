import { useState } from "react";
import { api } from "../api";
import { useToast } from "../context";
import { ago } from "../hooks";
import type { NewToken, TokenInfo } from "../types";
import { Modal, TokenReveal } from "./ui";

const EXPIRY: { value: string; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "", label: "Never" },
];

/** Name and expiry for a new token; after creation the same dialog shows the token once. */
export function NewTokenDialog({ title, path, intro, onClose, onCreated }: { title: string; path: string; intro?: string; onClose: () => void; onCreated?: () => void }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("90");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<NewToken | null>(null);

  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<NewToken>(path, { label: label.trim(), expiresInDays: days ? Number(days) : undefined });
      setCreated(r);
      onCreated?.();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (created)
    return (
      <Modal
        title="Token created"
        onClose={onClose}
        footer={
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <TokenReveal token={created.token} label={created.info.label} />
      </Modal>
    );

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!label.trim() || busy}>
            {busy ? "Creating…" : "Create token"}
          </button>
        </>
      }
    >
      {intro && <p className="muted">{intro}</p>}
      <div className="field-row">
        <label className="field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. laptop CLI, GitHub Actions" maxLength={80} required data-autofocus />
        </label>
        <label className="field" style={{ flex: "0 1 140px" }}>
          <span>Expires after</span>
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            {EXPIRY.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}

export function TokenExpiry({ info }: { info: TokenInfo }) {
  if (!info.expiresAt) return <span className="muted">Never</span>;
  const at = new Date(info.expiresAt);
  if (at.getTime() < Date.now()) return <span className="bad-text">Expired</span>;
  return <time dateTime={info.expiresAt}>{at.toLocaleDateString()}</time>;
}

export const lastUsed = (iso?: string) => (iso ? ago(iso) : "Never");
export const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : "");
/** Generated tokens keep a short visible prefix; tokens a person chose show nothing. */
export const tokenHint = (t: TokenInfo) => (t.prefix ? `${t.prefix}…` : "hidden");
/** Tokens from ACAI_TOKENS / ACAI_TOKEN: read-only, changed only in the server environment. */
export const envToken = (t: TokenInfo) => t.id.startsWith("env-");
