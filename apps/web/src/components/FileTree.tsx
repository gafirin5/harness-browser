import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';

interface Entry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink';
}

interface TreeResponse {
  data: Entry[];
}

export function FileTree({
  worktreeId,
  onOpenFile
}: {
  worktreeId: string;
  onOpenFile: (path: string, name: string) => void;
}): JSX.Element {
  const [entries, setEntries] = useState<Record<string, Entry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (directory: string): Promise<Entry[]> => {
      const response = await apiGet<TreeResponse>(
        `/files/tree?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(directory)}`
      );
      return response.data;
    },
    [worktreeId]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const root = await load('');
      setEntries({ '': root });
      setExpanded(new Set());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat file.');
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (entry: Entry): Promise<void> => {
    const next = new Set(expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
      setExpanded(next);
      return;
    }
    if (!entries[entry.path]) {
      setLoading(true);
      try {
        const children = await load(entry.path);
        setEntries((current) => ({ ...current, [entry.path]: children }));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Gagal memuat folder.');
        setLoading(false);
        return;
      }
      setLoading(false);
    }
    next.add(entry.path);
    setExpanded(next);
  };

  const renderLevel = (directory: string, depth: number): JSX.Element[] => {
    const list = entries[directory] ?? [];
    return list.map((entry) => {
      const isOpen = expanded.has(entry.path);
      if (entry.type === 'dir') {
        return (
          <div key={entry.path}>
            <button
              type="button"
              className="file-row"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => void toggle(entry)}
              aria-expanded={isOpen}
            >
              <span className="file-caret">{isOpen ? '▾' : '▸'}</span>
              <span className="file-icon">▦</span>
              <span className="file-name">{entry.name}</span>
            </button>
            {isOpen ? renderLevel(entry.path, depth + 1) : null}
          </div>
        );
      }
      return (
        <button
          key={entry.path}
          type="button"
          className="file-row"
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => onOpenFile(entry.path, entry.name)}
          title={entry.path}
        >
          <span className="file-caret" />
          <span className="file-icon">{entry.type === 'symlink' ? '↗' : '·'}</span>
          <span className="file-name">{entry.name}</span>
        </button>
      );
    });
  };

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="sidebar-title">Files</span>
        <button className="icon-btn" title="Muat ulang file" onClick={() => void refresh()} disabled={loading}>
          ↻
        </button>
      </div>
      {error ? <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {loading && !entries[''] ? <div className="empty">Memuat file...</div> : null}
      {entries[''] ? <div className="file-tree">{renderLevel('', 0)}</div> : null}
    </div>
  );
}