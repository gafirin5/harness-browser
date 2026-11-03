import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';
import { Modal } from './ui';

interface SearchMatch {
  line: number;
  column: number;
  text: string;
}

interface SearchFile {
  path: string;
  matches: SearchMatch[];
}

interface SearchResponse {
  data: {
    query: string;
    files: SearchFile[];
    total: number;
    truncated: boolean;
  };
  meta: {
    engine: string;
    durationMs: number;
    maxResults: number;
  };
}

export function SearchDialog({
  worktreeId,
  onClose,
  onOpen
}: {
  worktreeId: string | null;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [files, setFiles] = useState<SearchFile[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [meta, setMeta] = useState<{ engine: string; durationMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (value: string): Promise<void> => {
      if (!worktreeId) return;
      const id = requestId.current + 1;
      requestId.current = id;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('worktreeId', worktreeId);
        params.set('q', value);
        params.set('caseSensitive', caseSensitive ? '1' : '0');
        params.set('regex', regex ? '1' : '0');
        params.set('maxResults', '100');
        const response = await apiGet<SearchResponse>(`/search?${params.toString()}`);
        if (requestId.current !== id) return;
        setFiles(response.data.files);
        setTotal(response.data.total);
        setTruncated(response.data.truncated);
        setMeta({ engine: response.meta.engine, durationMs: response.meta.durationMs });
        setSearched(true);
      } catch (caught) {
        if (requestId.current !== id) return;
        setFiles([]);
        setTotal(0);
        setTruncated(false);
        setMeta(null);
        setSearched(true);
        setError(caught instanceof ApiError ? caught.message : 'Pencarian gagal.');
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    },
    [caseSensitive, regex, worktreeId]
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!worktreeId || trimmed.length < 2) {
      requestId.current += 1;
      setFiles([]);
      setTotal(0);
      setTruncated(false);
      setMeta(null);
      setSearched(false);
      setError(null);
      setLoading(false);
      return undefined;
    }
    const timer = window.setTimeout(() => void run(trimmed), 320);
    return () => window.clearTimeout(timer);
  }, [query, run, worktreeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Modal
      title="Cari Kode"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {!worktreeId ? <div className="empty">Pilih worktree terlebih dahulu untuk mencari kode.</div> : null}

      {worktreeId ? (
        <>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = query.trim();
              if (trimmed.length >= 2) void run(trimmed);
            }}
          >
            <input
              ref={inputRef}
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari teks di worktree... (min. 2 karakter)"
              aria-label="Cari kode"
            />
            <button
              type="button"
              className={`btn tiny ${caseSensitive ? 'primary' : ''}`}
              onClick={() => setCaseSensitive((value) => !value)}
              title="Bedakan huruf besar/kecil"
            >
              Aa
            </button>
            <button
              type="button"
              className={`btn tiny ${regex ? 'primary' : ''}`}
              onClick={() => setRegex((value) => !value)}
              title="Gunakan regular expression"
            >
              .*
            </button>
            <button className="btn tiny primary" type="submit" disabled={loading || query.trim().length < 2}>
              Cari
            </button>
          </form>

          <div className="search-meta">
            {loading ? <span>Mencari...</span> : null}
            {!loading && searched && !error ? (
              <span>
                {total} hasil di {files.length} file
                {truncated ? ' · dibatasi 100 hasil' : ''}
                {meta ? ` · ${meta.engine} · ${meta.durationMs} ms` : ''}
              </span>
            ) : null}
            {!loading && !searched && !error ? (
              <span className="muted">Hasil muncul otomatis saat mengetik. Klik hasil untuk membuka file.</span>
            ) : null}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          {!loading && searched && !error && files.length === 0 ? (
            <div className="empty">Tidak ada hasil untuk pencarian ini.</div>
          ) : null}

          {files.length > 0 ? (
            <div className="search-results">
              {files.map((file) => (
                <div className="search-file" key={file.path}>
                  <div className="search-file-head">
                    <span className="mono">{file.path}</span>
                    <span className="muted">{file.matches.length} hasil</span>
                  </div>
                  {file.matches.map((match) => (
                    <button
                      type="button"
                      className="search-match"
                      key={`${file.path}:${match.line}:${match.column}`}
                      onClick={() => onOpen(file.path, match.line)}
                    >
                      <span className="search-line">{match.line}</span>
                      <span className="search-text mono">{match.text || '(baris kosong)'}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}