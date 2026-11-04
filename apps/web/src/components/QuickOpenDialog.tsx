import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiGet } from '../lib/api';

interface QuickFile {
  path: string;
  name: string;
  dir: string;
}

export function QuickOpenDialog({
  worktreeId,
  onClose,
  onOpen
}: {
  worktreeId: string | null;
  onClose: () => void;
  onOpen: (path: string, name: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<QuickFile[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!worktreeId) return undefined;
    const id = requestId.current + 1;
    requestId.current = id;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      apiGet<{ data: QuickFile[] }>(
        `/files/find?worktreeId=${encodeURIComponent(worktreeId)}&q=${encodeURIComponent(query.trim())}`
      )
        .then((response) => {
          if (requestId.current !== id) return;
          setFiles(response.data);
          setSelected(0);
        })
        .catch((caught: unknown) => {
          if (requestId.current !== id) return;
          setFiles([]);
          setError(caught instanceof ApiError ? caught.message : 'Gagal mencari file.');
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, worktreeId]);

  const choose = (file: QuickFile | undefined): void => {
    if (!file) return;
    onOpen(file.path, file.name);
    onClose();
  };

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette quick-open" role="dialog" aria-label="Quick Open">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((current) => Math.min(current + 1, Math.max(0, files.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((current) => Math.max(0, current - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(files[selected]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Cari file di worktree ini... (Alt+P)"
          aria-label="Cari file"
        />
        <div className="palette-list" role="listbox">
          {!worktreeId ? <div className="empty">Pilih worktree terlebih dahulu.</div> : null}
          {loading ? <div className="empty">Mencari file...</div> : null}
          {error ? <div className="empty">{error}</div> : null}
          {!loading && !error && worktreeId && files.length === 0 ? (
            <div className="empty">File tidak ditemukan.</div>
          ) : null}
          {files.map((file, index) => (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={index === selected}
              className={`palette-item ${index === selected ? 'active' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => choose(file)}
            >
              <span className="palette-label">{file.name}</span>
              <span className="palette-hint">{file.dir || '/'}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span>↑↓ navigasi</span>
          <span>Enter buka</span>
          <span>Esc tutup</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
