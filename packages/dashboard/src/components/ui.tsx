import { Loader2, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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

const ACTOR_KIND = { human: "", agent: "agent", "mcp-host": "MCP", system: "system" } as const;
export function ActorTag({ actor }: { actor: Actor }) {
  const kind = ACTOR_KIND[actor.type] ?? "";
  return (
    <span className={`actor actor-${actor.type}`}>
      {actor.name}
      {kind ? <span className="muted"> ({kind})</span> : <span className="sr-only"> (person)</span>}
    </span>
  );
}

/** Page title, an optional one-line description and right-aligned actions. */
export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {description && <div className="desc">{description}</div>}
      </div>
      {actions && <div className="actions-end">{actions}</div>}
    </div>
  );
}

/** A section heading with an optional description and actions on the right. */
export function SectionHead({ title, description, actions, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="section-head">
      <div className="grow">
        <h2 id={id}>{title}</h2>
        {description && <div className="desc">{description}</div>}
      </div>
      {actions}
    </div>
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

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
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
    <button className="btn btn-sm" onClick={copy} type="button" aria-live="polite">
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

/** Asks before a destructive or irreversible action. */
export function ConfirmDialog(props: {
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      onSubmit={props.onConfirm}
      footer={
        <>
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className={props.danger ? "btn btn-danger btn-solid" : "btn btn-primary"} disabled={props.busy}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      {props.children}
    </Modal>
  );
}

/** A newly created secret, shown once: read-only, selectable, copyable. */
export function TokenReveal({ token, label = "Access token" }: { token: string; label?: string }) {
  const note = useId();
  return (
    <div className="token-reveal">
      <label className="field">
        <span>{label}</span>
        <div className="row">
          <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} aria-describedby={note} spellCheck={false} autoFocus data-autofocus />
          <CopyButton text={token} />
        </div>
      </label>
      <p id={note} className="muted">
        Copy it now. You won't be able to see it again.
      </p>
    </div>
  );
}

/**
 * A button that opens a small menu. Items are elements with role="menuitem"; choosing one
 * closes the menu. Arrow keys move, Escape closes and returns focus to the button.
 */
export function Menu({ label, button, buttonClass = "icon-btn", children, header }: { label: string; button: ReactNode; buttonClass?: string; children: ReactNode; header?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? [])];
  const toggle = () => {
    // Fixed position, so the menu is never clipped by a scrolling table.
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const close = () => setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (!open) return;
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = list.length;
      list[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={btn} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label} onClick={toggle}>
        {button}
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          id={id}
          style={{ top: pos.top, right: pos.right }}
          aria-label={label}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[role='menuitem']")) setOpen(false);
          }}
        >
          {header && <div className="menu-head">{header}</div>}
          {children}
        </div>
      )}
    </div>
  );
}
