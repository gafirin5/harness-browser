import { useEffect, useId, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function Spinner({ label = 'Memuat...' }: { label?: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-primary" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonClass: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  danger: 'btn btn-danger',
  ghost: 'btn btn-ghost'
};

export function Button({
  variant = 'primary',
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }): JSX.Element {
  return (
    <button {...rest} disabled={disabled || loading} className={`${buttonClass[variant]} ${rest.className ?? ''}`}>
      {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Input({
  label,
  error,
  hint,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }): JSX.Element {
  const autoId = useId();
  const inputId = id ?? `input-${autoId}`;
  const describedBy = [error ? `${inputId}-error` : '', hint ? `${inputId}-hint` : ''].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className={`input ${error ? 'input-error' : ''} ${rest.className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Textarea({
  label,
  error,
  hint,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }): JSX.Element {
  const autoId = useId();
  const inputId = id ?? `textarea-${autoId}`;
  const describedBy = [error ? `${inputId}-error` : '', hint ? `${inputId}-hint` : ''].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <textarea
        {...rest}
        id={inputId}
        className={`input ${error ? 'input-error' : ''} ${rest.className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${inputId}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  error,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }): JSX.Element {
  const autoId = useId();
  const inputId = id ?? `select-${autoId}`;
  return (
    <div>
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <select
        {...rest}
        id={inputId}
        className={`input ${error ? 'input-error' : ''} ${rest.className ?? ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
      >
        {children}
      </select>
      {error ? (
        <p id={`${inputId}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Select dengan filter pencarian di atasnya. Tetap memakai elemen <select>
 * native agar kompatibel penuh dengan Chrome 93 dan pembaca layar.
 */
export function SearchableSelect({
  label,
  name,
  value,
  options,
  onChange,
  error,
  required = false
}: {
  label: string;
  name: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
}): JSX.Element {
  const autoId = useId();
  const selectId = `select-${autoId}`;
  const [filter, setFilter] = useState('');

  const selected = options.find((option) => option.value === value);
  const matched = filter
    ? options.filter((option) => option.label.toLowerCase().includes(filter.toLowerCase()))
    : options;
  const visible =
    selected && !matched.some((option) => option.value === selected.value) ? [selected, ...matched] : matched;

  return (
    <div>
      <label htmlFor={selectId} className="field-label">
        {label}
      </label>
      <input
        type="search"
        className="input mb-1"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={`Cari ${label.toLowerCase()}...`}
        aria-label={`Cari ${label}`}
      />
      <select
        id={selectId}
        name={name}
        className={`input ${error ? 'input-error' : ''}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : undefined}
      >
        <option value="">Pilih...</option>
        {visible.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'primary';

const badgeToneClass: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success border-success',
  warning: 'bg-warning-soft text-warning border-warning',
  danger: 'bg-danger-soft text-danger border-danger',
  neutral: 'bg-slate-100 text-slate-700 border-slate-400',
  primary: 'bg-primary-soft text-primary border-primary'
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }): JSX.Element {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${badgeToneClass[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  if (status === 'IDLE' || status === 'COMPLETED' || status === 'ACTIVE') return 'success';
  if (status === 'BUSY' || status === 'QUEUED' || status === 'RUNNING') return 'warning';
  if (status === 'OFFLINE' || status === 'FAILED' || status === 'CANCELLED' || status === 'INACTIVE') return 'danger';
  return 'neutral';
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-ink">
      <span>{message}</span>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Coba Lagi
        </Button>
      ) : null}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}): JSX.Element | null {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        Halaman {page} dari {totalPages} · {total} data
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Sebelumnya
        </Button>
        <Button variant="secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Berikutnya
        </Button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button');
      focusable?.focus();
    }, 10);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal-panel ${wide ? 'max-w-3xl' : ''}`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="modal-title" className="text-base font-bold text-ink">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Tutup dialog">
            Tutup
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Ya, lanjutkan',
  pending = false,
  onConfirm,
  onClose
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element | null {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink">{message}</div>
    </Modal>
  );
}
