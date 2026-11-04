import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ---------- toast ---------- */

type ToastType = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}
interface ToastValue {
  push: (type: ToastType, message: string) => void;
}
const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((type: ToastType, message: string) => {
    const id = next.current++;
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast harus di dalam ToastProvider');
  return ctx;
}

/* ---------- modal ---------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => {
      panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    }, 20);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

/* ---------- fields ---------- */

export function Field({
  label,
  error,
  hint,
  children
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

export function Spinner(): JSX.Element {
  return <span className="spin" aria-label="Memuat" />;
}

export function StatusBadge({ status }: { status: string }): JSX.Element {
  return <span className={`badge ${status}`}>{status}</span>;
}
