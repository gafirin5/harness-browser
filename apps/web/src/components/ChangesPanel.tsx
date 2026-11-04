import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Modal, useToast } from './ui';

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
  const { push } = useToast();
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [commitError, setCommitError] = useState<string | null>(null);

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

  const stage = async (path?: string): Promise<void> => {
    setBusy(true);
    try {
      await apiPost('/git/stage', { worktreeId, ...(path ? { path } : {}) });
      await load();
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal stage.');
    } finally {
      setBusy(false);
    }
  };

  const unstage = async (path: string): Promise<void> => {
    setBusy(true);
    try {
      await apiPost('/git/unstage', { worktreeId, path });
      await load();
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal unstage.');
    } finally {
      setBusy(false);
    }
  };

  const sync = async (action: 'pull' | 'push'): Promise<void> => {
    setBusy(true);
    try {
      const response = await apiPost<{ data: { output: string } }>(`/git/${action}`, { worktreeId });
      push('success', `${action === 'pull' ? 'Pull' : 'Push'}: ${response.data.output.slice(0, 180)}`);
      await load();
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : `Gagal ${action}.`);
    } finally {
      setBusy(false);
    }
  };

  const commit = async (): Promise<void> => {
    setCommitError(null);
    setBusy(true);
    try {
      const response = await apiPost<{ data: { hash: string; summary: string } }>('/git/commit', {
        worktreeId,
        message
      });
      push('success', `Commit ${response.data.hash.slice(0, 7)}: ${response.data.summary}`);
      setCommitOpen(false);
      setMessage('');
      await load();
    } catch (caught) {
      setCommitError(caught instanceof ApiError ? caught.message : 'Commit gagal.');
    } finally {
      setBusy(false);
    }
  };

  const stagedCount = status?.files.filter((file) => file.staged).length ?? 0;

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
      {error ? (
        <div className="empty" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}
      {status ? (
        <div className="changes">
          <div className="change-branch mono">
            {status.branch ?? 'detached'}
            {status.ahead > 0 ? ` ↑${status.ahead}` : ''}
            {status.behind > 0 ? ` ↓${status.behind}` : ''}
          </div>
          <div className="change-actions">
            <button className="btn tiny" onClick={() => void stage()} disabled={busy || status.clean}>
              + Stage All
            </button>
            <button
              className="btn tiny primary"
              onClick={() => setCommitOpen(true)}
              disabled={busy || stagedCount === 0}
            >
              Commit{stagedCount > 0 ? ` (${stagedCount})` : ''}
            </button>
          </div>
          <div className="change-actions">
            <button className="btn tiny" onClick={() => void sync('pull')} disabled={busy}>
              ↓ Pull
            </button>
            <button className="btn tiny" onClick={() => void sync('push')} disabled={busy}>
              ↑ Push
            </button>
          </div>
          {status.clean ? (
            <div className="empty">Working tree bersih.</div>
          ) : (
            <div className="change-list">
              {status.files.map((file) => (
                <div
                  key={`${file.path}:${file.staged ? 's' : 'u'}`}
                  className="change-row"
                  title={file.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenDiff(file.path, file.staged && !file.unstaged)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpenDiff(file.path, file.staged && !file.unstaged);
                  }}
                >
                  <span className={`change-code ${file.untracked ? 'untracked' : ''}`}>
                    {file.untracked ? 'U' : file.status.replace(/ /g, '') || 'M'}
                  </span>
                  <span className="change-path">{file.path}</span>
                  {file.unstaged || file.untracked ? (
                    <button
                      className="change-action"
                      title="Stage file"
                      onClick={(event) => {
                        event.stopPropagation();
                        void stage(file.path);
                      }}
                      disabled={busy}
                    >
                      +
                    </button>
                  ) : null}
                  {file.staged ? (
                    <button
                      className="change-action"
                      title="Unstage file"
                      onClick={(event) => {
                        event.stopPropagation();
                        void unstage(file.path);
                      }}
                      disabled={busy}
                    >
                      −
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="empty">Memuat status Git...</div>
      )}

      {commitOpen ? (
        <Modal
          title="Commit Perubahan"
          onClose={() => setCommitOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCommitOpen(false)} disabled={busy}>
                Batal
              </button>
              <button
                className="btn primary"
                type="submit"
                form="commit-form"
                disabled={busy || message.trim().length < 3}
                title="Ctrl+Enter"
              >
                {busy ? 'Commit...' : 'Commit'}
              </button>
            </>
          }
        >
          <form
            id="commit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
          >
            {commitError ? <div className="error-banner">{commitError}</div> : null}
            <div className="field">
              <label>Pesan commit</label>
              <textarea
                className="textarea"
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Jelaskan perubahan..."
                autoFocus
              />
              <div className="hint">{message.trim().length} karakter · minimal 3</div>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
