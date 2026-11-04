import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = 'Ketik perintah... (Ctrl+Shift+P)'
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) => command.label.toLowerCase().includes(needle) || (command.hint ?? '').toLowerCase().includes(needle)
    );
  }, [commands, query]);

  useEffect(() => {
    if (index >= filtered.length) setIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, index]);

  if (!open) return null;

  const run = (command: Command | undefined): void => {
    if (!command) return;
    onClose();
    command.run();
  };

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(filtered[index]);
            }
          }}
          placeholder={placeholder}
          aria-label="Cari perintah"
        />
        <div className="palette-list" role="listbox">
          {filtered.length === 0 ? <div className="empty">Perintah tidak ditemukan.</div> : null}
          {filtered.map((command, itemIndex) => (
            <button
              key={command.id}
              type="button"
              role="option"
              aria-selected={itemIndex === index}
              className={`palette-item ${itemIndex === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(itemIndex)}
              onClick={() => run(command)}
            >
              <span className="palette-label">{command.label}</span>
              {command.hint ? <span className="palette-hint">{command.hint}</span> : null}
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigasi</span>
          <span>Enter jalankan</span>
          <span>Esc tutup</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
