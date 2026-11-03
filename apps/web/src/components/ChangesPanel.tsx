import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';

export interface GitChangedFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitChangedFile[];
  clean: boolean;
}

export function ChangesPanel({
  worktreeId,
  onOpenDiff
}: {
  worktreeId: string;
  onOpenDiff: (path: string, staged: boolean) => void;
}): JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: GitStatus }>(`/git/status?worktreeId=${encodeURIComponent(worktreeId)}`);
      setStatus(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat status Git.');
    } finally {
      setLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="files-panel">
      <div className="files-head">
        <span className="sidebar-title">Changes</span>
        <span className="row" style={{ gap: 4 }}>
          {status ? <span className="badge">{status.files.length}</span> : null}
          <button className="icon-btn" title="Muat ulang status Git" onClick={() => void load()} disabled={loading}>
            ↻
          </button>
        </span>
      </div>
      {error ? <div className="empty" style={{ color: 'var(--danger)' }}>{error}</div> : null}
      {status ? (
        <div className="changes">
          <div className="change-branch mono">
            {status.branch ?? 'detached'}
            {status.ahead > 0 ? ` ↑${status.ahead}` : ''}
            {status.behind > 0 ? ` ↓${status.behind}` : ''}
          </div>
          {status.clean ? (
            <div className="empty">Working tree bersih.</div>
          ) : (
            <div className="change-list">
              {status.files.map((file) => (
                <button
                  key={`${file.path}:${file.staged ? 's' : 'u'}`}
                  type="button"
                  className="change-row"
                  title={file.path}
                  onClick={() => onOpenDiff(file.path, file.staged && !file.unstaged)}
                >
                  <span className={`change-code ${file.untracked ? 'untracked' : ''}`}>
                    {file.untracked ? 'U' : file.status.replace(/ /g, '') || 'M'}
                  </span>
                  <span className="change-path">{file.path}</span>
                  {file.staged ? <span className="badge completed">staged</span> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="empty">Memuat status Git...</div>
      )}
    </div>
  );
}