import { useEffect, useRef, useState } from 'react';
import type { AgentInfo, DiffComment, SessionInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { Modal, useToast } from './ui';

interface DiffLine {
  text: string;
  className: string;
  newLine: number | null;
}

export function parseDiffLines(diff: string): DiffLine[] {
  let nextLine = 0;
  return diff.split('\n').map((line) => {
    let className = 'diff-line';
    let newLine: number | null = null;

    if (line.startsWith('@@')) {
      className += ' hunk';
      const match = /\+(\d+)/.exec(line);
      if (match) nextLine = Number(match[1]);
    } else if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('diff ') ||
      line.startsWith('index ')
    ) {
      className += ' meta';
    } else if (line.startsWith('+')) {
      className += ' add';
      if (nextLine > 0) {
        newLine = nextLine;
        nextLine += 1;
      }
    } else if (line.startsWith('-')) {
      className += ' del';
    } else if (line.startsWith(' ')) {
      if (nextLine > 0) {
        newLine = nextLine;
        nextLine += 1;
      }
    }

    return { text: line, className, newLine };
  });
}

function buildPrompt(filePath: string, comments: DiffComment[]): string {
  const sorted = [...comments].sort((a, b) => a.line - b.line);
  const lines = sorted.map((comment) => `- Baris ${comment.line}: ${comment.body}`);
  return [
    `Tolong tangani komentar review berikut pada file ${filePath}:`,
    '',
    ...lines,
    '',
    'Perbaiki kode sesuai komentar tersebut, lalu jelaskan perubahan yang dibuat.'
  ].join('\n');
}

function SendToAgentDialog({
  worktreeId,
  filePath,
  comments,
  onClose,
  onStarted
}: {
  worktreeId: string;
  filePath: string;
  comments: DiffComment[];
  onClose: () => void;
  onStarted: (session: SessionInfo) => void;
}): JSX.Element {
  const { push } = useToast();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agent, setAgent] = useState('');
  const [title, setTitle] = useState(`Review ${filePath.split('/').pop() ?? filePath}`);
  const [selected, setSelected] = useState<string[]>(comments.map((comment) => comment.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: AgentInfo[] }>('/agents')
      .then((response) => {
        if (cancelled) return;
        const installed = response.data.filter((item) => item.installed);
        setAgents(installed);
        setAgent(installed[0]?.id ?? '');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Gagal memuat agent.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chosen = comments.filter((comment) => selected.includes(comment.id));

  const submit = async (): Promise<void> => {
    if (!agent) {
      setError('Pilih agent terlebih dahulu.');
      return;
    }
    if (chosen.length === 0) {
      setError('Pilih minimal satu komentar.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: SessionInfo }>('/sessions', {
        worktreeId,
        agent,
        title: title.trim() || `Review ${filePath}`,
        prompt: buildPrompt(filePath, chosen)
      });
      push('success', 'Sesi review dijalankan.');
      onStarted(response.data);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menjalankan sesi review.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="Kirim Komentar ke Agent"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>
            Batal
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={pending || !agent}>
            {pending ? 'Menjalankan...' : 'Jalankan Agent'}
          </button>
        </>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="field">
        <label>Agent</label>
        <select className="input" value={agent} onChange={(event) => setAgent(event.target.value)}>
          {agents.length === 0 ? <option value="">Tidak ada agent terpasang</option> : null}
          {agents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Judul sesi</label>
        <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} />
      </div>
      <div className="field">
        <label>Komentar yang dikirim ({chosen.length})</label>
        <div className="diff-send-list">
          {comments.map((comment) => (
            <label className="diff-send-item" key={comment.id}>
              <input
                type="checkbox"
                checked={selected.includes(comment.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked ? [...current, comment.id] : current.filter((id) => id !== comment.id)
                  )
                }
              />
              <span className="mono">baris {comment.line}</span>
              <span>{comment.body}</span>
            </label>
          ))}
        </div>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Agent akan menerima prompt berisi semua komentar terpilih untuk file ini.
      </p>
    </Modal>
  );
}

export function DiffViewer({
  worktreeId,
  filePath,
  initialStaged,
  onSessionStarted
}: {
  worktreeId: string;
  filePath: string;
  initialStaged: boolean;
  onSessionStarted?: (session: SessionInfo) => void;
}): JSX.Element {
  const [staged, setStaged] = useState(initialStaged);
  const [diff, setDiff] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<{ data: { diff: string; truncated: boolean } }>(
      `/git/diff?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(filePath)}&staged=${staged ? '1' : '0'}`
    )
      .then((response) => {
        if (cancelled) return;
        setDiff(response.data.diff);
        setTruncated(response.data.truncated);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Gagal memuat diff.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeId, filePath, staged]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ data: DiffComment[] }>(
      `/review?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(filePath)}`
    )
      .then((response) => {
        if (!cancelled) setComments(response.data);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreeId, filePath]);

  const lines = parseDiffLines(diff);
  const openComments = comments.filter((comment) => !comment.resolvedAt);
  const commentCount = (line: number | null): number =>
    line === null ? 0 : comments.filter((comment) => comment.line === line).length;

  const openComposer = (line: number): void => {
    setActiveLine(line);
    setDraft('');
    window.setTimeout(() => editorRef.current?.focus(), 20);
  };

  const closeComposer = (): void => {
    setActiveLine(null);
    setDraft('');
  };

  const saveComment = async (): Promise<void> => {
    if (activeLine === null || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiPost<{ data: DiffComment }>('/review', {
        worktreeId,
        path: filePath,
        line: activeLine,
        body: draft.trim()
      });
      setComments((current) => [...current, response.data]);
      closeComposer();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan komentar.');
    } finally {
      setSaving(false);
    }
  };

  const deleteComment = async (comment: DiffComment): Promise<void> => {
    try {
      await apiDelete(`/review/${comment.id}`);
      setComments((current) => current.filter((item) => item.id !== comment.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus komentar.');
    }
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <span className="mono" style={{ color: 'var(--text)' }}>
          {filePath}
        </span>
        <div className="row" style={{ gap: 2 }}>
          <button className={`btn tiny ${!staged ? 'primary' : ''}`} onClick={() => setStaged(false)}>
            Unstaged
          </button>
          <button className={`btn tiny ${staged ? 'primary' : ''}`} onClick={() => setStaged(true)}>
            Staged
          </button>
        </div>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 11 }}>
          Anotasi ({openComments.length})
        </span>
        <button
          className="btn tiny primary"
          onClick={() => setSendOpen(true)}
          disabled={openComments.length === 0 || !onSessionStarted}
          title="Kirim komentar ke agent"
        >
          Kirim ke Agent
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          {truncated ? 'diff dipotong 500 KB' : ''}
        </span>
      </div>
      {error ? (
        <div className="error-banner" style={{ margin: 10 }}>
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="empty">Memuat diff...</div>
      ) : !diff ? (
        <div className="empty">Tidak ada perubahan pada mode {staged ? 'staged' : 'unstaged'}.</div>
      ) : (
        <div className="diff-view" aria-label={`Diff ${filePath}`}>
          {lines.map((line, index) => {
            const lineComments = line.newLine === null ? [] : comments.filter((c) => c.line === line.newLine);
            return (
              <div key={index} className="diff-line-group">
                <div
                  className={`${line.className} ${line.newLine && activeLine === line.newLine ? 'active' : ''}`}
                  tabIndex={line.newLine ? 0 : -1}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'c' &&
                      !event.ctrlKey &&
                      !event.metaKey &&
                      !event.altKey &&
                      line.newLine &&
                      event.target === event.currentTarget
                    ) {
                      event.preventDefault();
                      openComposer(line.newLine);
                    }
                  }}
                >
                  <button
                    className="diff-line-no"
                    disabled={!line.newLine}
                    onClick={() => line.newLine && openComposer(line.newLine)}
                    title={line.newLine ? 'Tambah komentar (c)' : undefined}
                    type="button"
                  >
                    {line.newLine ?? ''}
                  </button>
                  <span className="diff-line-text">{line.text || ' '}</span>
                  {commentCount(line.newLine) > 0 ? (
                    <span className="diff-comment-count">{commentCount(line.newLine)}</span>
                  ) : null}
                </div>
                {activeLine !== null && activeLine === line.newLine ? (
                  <div className="diff-comment-box">
                    <textarea
                      ref={editorRef}
                      className="textarea"
                      rows={3}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="Tulis komentar untuk baris ini..."
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void saveComment();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          closeComposer();
                        }
                      }}
                    />
                    <div className="diff-comment-box-foot">
                      <span className="hint">Enter simpan · Shift+Enter baris baru · Esc batal</span>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="btn tiny" onClick={closeComposer} disabled={saving}>
                          Batal
                        </button>
                        <button
                          className="btn tiny primary"
                          onClick={() => void saveComment()}
                          disabled={saving || !draft.trim()}
                        >
                          {saving ? 'Menyimpan...' : 'Simpan'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {lineComments.map((comment) => (
                  <div className="diff-comment" key={comment.id}>
                    <span className="diff-comment-marker">komentar</span>
                    <span className="diff-comment-body">{comment.body}</span>
                    <button
                      className="icon-btn"
                      onClick={() => void deleteComment(comment)}
                      title="Hapus komentar"
                      aria-label={`Hapus komentar baris ${comment.line}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {sendOpen ? (
        <SendToAgentDialog
          worktreeId={worktreeId}
          filePath={filePath}
          comments={openComments}
          onClose={() => setSendOpen(false)}
          onStarted={(session) => onSessionStarted?.(session)}
        />
      ) : null}
    </div>
  );
}
