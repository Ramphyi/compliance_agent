import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { ApiError } from "./api";
import type { Audit, AuditListItem, Finding, JobListItem, Meta, Profile } from "./types";

// ------------------------------------------------------------------ toasts
type ToastKind = "info" | "success" | "error";
type Toast = { id: number; kind: ToastKind; title?: string; text: string };

const ToastCtx = createContext<(kind: ToastKind, text: string, title?: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, text: string, title?: string) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-4), { id, kind, text, title }]);
      setTimeout(() => dismiss(id), kind === "error" ? 9000 : 5000);
    },
    [dismiss],
  );
  const Icon = { info: Info, success: CheckCircle2, error: XCircle };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.kind];
          return (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <I size={16} aria-hidden />
              <div>
                {t.title && <strong>{t.title}</strong>}
                <div>{t.text}</div>
              </div>
              <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(
    () => ({
      info: (text: string, title?: string) => push("info", text, title),
      success: (text: string, title?: string) => push("success", text, title),
      error: (e: unknown, title?: string) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof ApiError && e.status === 401) return; // the login screen takes over
        push("error", msg, title ?? (e instanceof ApiError && e.status === 409 ? "Not allowed in the current state" : undefined));
      },
    }),
    [push],
  );
}

// ------------------------------------------------------------------ project shell
export type Shell = {
  pid: string;
  meta: Meta;
  profile?: Profile;
  audits?: AuditListItem[];
  /** The audit being reviewed: undefined while loading, null when the project has none. */
  audit?: Audit | null;
  selectAudit: (id: string | null) => void;
  patchFinding: (f: Finding) => void;
  /** Bumped (debounced) on store changes; resources refetch when it changes. */
  version: number;
  /** Bumped on job events. */
  jobVersion: number;
  jobs: JobListItem[];
  running?: JobListItem;
  openJob: (jobId: string) => void;
  /** POST an endpoint that starts a job ({id} or {jobId} in the response) and open its log. */
  startJob: (path: string, body?: unknown) => Promise<string | undefined>;
  refresh: () => void;
};

export const ShellCtx = createContext<Shell | null>(null);

export function useShell() {
  const s = useContext(ShellCtx);
  if (!s) throw new Error("useShell outside a project");
  return s;
}
