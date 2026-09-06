import { LoaderCircle, Search, X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode } from "react";

type ButtonTone = "primary" | "dark" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ tone = "primary", loading, icon, children, className = "", ...props }: ButtonProps) {
  const disabled = loading || props.disabled;
  return (
    <button {...props} className={`button button--${tone} ${className}`} disabled={disabled}>
      {loading ? <LoaderCircle className="spin" size={17} /> : icon}
      <span>{children}</span>
    </button>
  );
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: "neutral" | "brand" | "success" | "warning" | "danger" }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function SearchInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`search-input ${className}`}>
      <Search size={16} aria-hidden="true" />
      <input {...props} />
      {props.value && <X size={14} aria-hidden="true" />}
    </label>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">◇</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Modal({ open, title, children, onClose, className = "" }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void; className?: string }>) {
  if (!open) return null;
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2 id="modal-title">{title}</h2><button onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        {children}
      </section>
    </div>
  );
}
