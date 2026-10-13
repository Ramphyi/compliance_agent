import {
  useEffect,
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  X,
  ShieldCheck,
} from "lucide-react";
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/"
      className={`logo ${light ? "light" : ""}`}
      aria-label="Clearance home"
    >
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M24 8H14L8 16l6 8h10M15 16h12" />
        </svg>
      </span>
      clearance<span className="logo-dot">.</span>
    </Link>
  );
}
export function Button({
  children,
  variant = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className || ""}`}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <ShieldCheck size={36} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button, [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea, [role="dialog"] a[href]',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>('[role="dialog"] button')?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const labelId = useId();
  const hintId = useId();
  // Explicit naming avoids select-option text and helper copy becoming labels.
  const labelControls = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement(node)) return node;
      const element = node as ReactElement<any>;
      if (
        typeof element.type === "string" &&
        ["input", "textarea", "select"].includes(element.type)
      ) {
        return cloneElement(element, {
          "aria-labelledby": labelId,
          "aria-describedby": hint ? hintId : undefined,
        });
      }
      return element.props.children
        ? cloneElement(element, {
            children: labelControls(element.props.children),
          })
        : element;
    });
  return (
    <label className="field">
      <span id={labelId}>{label}</span>
      {labelControls(children)}
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function CheckItem({ children }: { children: ReactNode }) {
  return (
    <div className="check-item">
      <Check size={16} />
      {children}
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
export const External = ({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) => (
  <a className="text-link" href={href} target="_blank" rel="noreferrer">
    {children}
    <ArrowUpRight size={14} />
  </a>
);
export function Breadcrumb({ section }: { section: string }) {
  return (
    <div className="breadcrumb">
      Workspace
      <ChevronRight size={13} />
      <strong>{section}</strong>
    </div>
  );
}
