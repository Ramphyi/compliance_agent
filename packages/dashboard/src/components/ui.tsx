import { Bot, Check, Copy, Loader2, Plug, Settings2, User, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type Actor, type FindingStatus, type Severity, STATUS_LABELS } from "../types";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`sev sev-${severity}`}>
      <i aria-hidden />
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: FindingStatus }) {
  return (
    <span className={`status st-${status}`}>
      <i aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const ACTOR_ICON = { human: User, agent: Bot, "mcp-host": Plug, system: Settings2 };
export function ActorTag({ actor }: { actor: Actor }) {
  const I = ACTOR_ICON[actor.type] ?? User;
  return (
    <span className={`actor actor-${actor.type}`} title={actor.type}>
      <I size={12} aria-hidden />
      {actor.name}
      <span className="sr-only"> ({actor.type})</span>
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <Loader2 size={14} className="spin" aria-hidden />
      {label ?? <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Loading({ what }: { what?: string }) {
  return (
    <div className="loading">
      <Spinner label={`Loading${what ? ` ${what}` : ""}…`} />
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="callout callout-error" role="alert">
      <span>{error}</span>
      {retry && (
        <button className="btn btn-sm" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Segmented<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === props.value}
          title={o.title}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is blocked in some iframes; fall back to a selection copy.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button className="btn btn-sm" onClick={copy} type="button">
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

export function Snippet({ text, label }: { text: string; label: string }) {
  return (
    <div className="snippet">
      <pre aria-label={label}>{text}</pre>
      <CopyButton text={text} />
    </div>
  );
}

/** Focus management shared by modals and drawers: focus inside, trap Tab, Escape closes, restore focus. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const focusable = () =>
      [...el.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), textarea, select, [tabindex='0']")];
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? focusable().find((x) => !x.dataset.close);
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      } else if (e.key === "Tab") {
        const list = focusable();
        if (!list.length) return;
        const [a, b] = [list[0], list[list.length - 1]];
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), b.focus());
        else if (!e.shiftKey && document.activeElement === b) (e.preventDefault(), a.focus());
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return ref;
}

type DialogProps = {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
  wide?: boolean;
};

export function Modal({ title, onClose, children, footer, onSubmit, wide }: DialogProps) {
  const ref = useDialog(onClose);
  const id = useId();
  const inner = (
    <>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </>
  );
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" data-close="1" onClick={onClose} aria-label="Close dialog" type="button">
            <X size={16} />
          </button>
        </header>
        {onSubmit ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {inner}
          </form>
        ) : (
          inner
        )}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useDialog(onClose);
  const id = useId();
  return (
    <div className="overlay overlay-drawer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <header className="drawer-head">
          <h2 id={id}>{title}</h2>
          {actions}
          <button className="icon-btn" data-close="1" onClick={onClose} aria-label="Close panel" type="button">
            <X size={16} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** A thin progress bar with an accessible value. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`meter-fill${tone ? ` meter-${tone}` : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
