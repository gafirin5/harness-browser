import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { useToast } from './ui';

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
  onOpenFile,
  onRenamed,
  onDeleted
}: {
  worktreeId: string;
  onOpenFile: (path: string, name: string) => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (path: string) => void;
}): JSX.Element {
  const { push } = useToast();
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

  const createEntry = async (type: 'file' | 'dir'): Promise<void> => {
    const target = window.prompt(
      type === 'file' ? 'Path file baru (relatif terhadap worktree):' : 'Path folder baru (relatif terhadap worktree):'
    );
    if (!target) return;
    try {
      await apiPost('/files/create', { worktreeId, path: target, type });
      await refresh();
      push('success', `${type === 'file' ? 'File' : 'Folder'} dibuat.`);
      if (type === 'file') onOpenFile(target.replace(/^\//, ''), target.split('/').pop() ?? target);
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal membuat file/folder.');
    }
  };

  const renameEntry = async (entry: Entry): Promise<void> => {
    const target = window.prompt('Path baru:', entry.path);
    if (!target || target === entry.path) return;
    try {
      await apiPost('/files/rename', { worktreeId, from: entry.path, to: target });
      await refresh();
      onRenamed(entry.path, target.replace(/^\//, ''));
      push('success', 'File/folder di-rename.');
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal rename.');
    }
  };

  const deleteEntry = async (entry: Entry): Promise<void> => {
    if (!window.confirm(`Hapus ${entry.path}?`)) return;
    try {
      await apiDelete(`/files?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(entry.path)}`);
      await refresh();
      onDeleted(entry.path);
      push('success', 'File/folder dihapus.');
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal menghapus.');
    }
  };

  const renderLevel = (directory: string, depth: number): JSX.Element[] => {
    const list = entries[directory] ?? [];
    return list.map((entry) => {
      const isOpen = expanded.has(entry.path);
      if (entry.type === 'dir') {
        return (
          <div key={entry.path}>
            <div
              className="file-row"
              style={{ paddingLeft: 6 + depth * 12 }}
              role="button"
              tabIndex={0}
              onClick={() => void toggle(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void toggle(entry);
              }}
            >
              <span className="file-caret">{isOpen ? '▾' : '▸'}</span>
              <span className="file-icon">▦</span>
              <span className="file-name">{entry.name}</span>
              <span className="file-actions">
                <button
                  className="file-action"
                  title="Rename"
                  onClick={(event) => {
                    event.stopPropagation();
                    void renameEntry(entry);
                  }}
                >
                  ✎
                </button>
                <button
                  className="file-action"
                  title="Hapus"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteEntry(entry);
                  }}
                >
                  ×
                </button>
              </span>
            </div>
            {isOpen ? renderLevel(entry.path, depth + 1) : null}
          </div>
        );
      }
      return (
        <div
          key={entry.path}
          className="file-row"
          style={{ paddingLeft: 6 + depth * 12 }}
          role="button"
          tabIndex={0}
          title={entry.path}
          onClick={() => onOpenFile(entry.path, entry.name)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onOpenFile(entry.path, entry.name);
          }}
        >
          <span className="file-caret" />
          <span className="file-icon">{entry.type === 'symlink' ? '↗' : '·'}</span>
          <span className="file-name">{entry.name}</span>
          <span className="file-actions">
            <button
              className="file-action"
              title="Rename"
              onClick={(event) => {
                event.stopPropagation();
                void renameEntry(entry);
              }}
            >
              ✎
            </button>
            <button
              className="file-action"
              title="Hapus"
              onClick={(event) => {
                event.stopPropagation();
                void deleteEntry(entry);
              }}
            >
              ×
            </button>
          </span>
        </div>
      );
    });
  };

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="sidebar-title">Files</span>
        <span className="row" style={{ gap: 2 }}>
          <button className="icon-btn" title="File baru" onClick={() => void createEntry('file')}>
            +
          </button>
          <button className="icon-btn" title="Folder baru" onClick={() => void createEntry('dir')}>
            ▦+
          </button>
          <button className="icon-btn" title="Muat ulang file" onClick={() => void refresh()} disabled={loading}>
            ↻
          </button>
        </span>
      </div>
      {error ? <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {loading && !entries[''] ? <div className="empty">Memuat file...</div> : null}
      {entries[''] ? <div className="file-tree">{renderLevel('', 0)}</div> : null}
    </div>
  );
}