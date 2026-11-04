import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Modal, useToast } from './ui';

interface GitHubRef {
  owner: string;
  repo: string;
}

interface GitHubRepo {
  fullName: string;
  description: string | null;
  htmlUrl: string;
  defaultBranch: string;
  openIssuesCount: number;
  stars: number;
  private: boolean;
}

interface GitHubInfo {
  connected: boolean;
  reason?: string;
  remote: string | null;
  ref?: GitHubRef;
  repo?: GitHubRepo;
}

interface Pull {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  htmlUrl: string;
  author: string;
  head: string;
  base: string;
  updatedAt: string;
}

interface IssueLabel {
  name: string;
  color: string;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  author: string;
  labels: IssueLabel[];
  updatedAt: string;
}

type Tab = 'pulls' | 'issues';
type StateFilter = 'open' | 'closed' | 'all';

const STATE_LABEL: Record<StateFilter, string> = {
  open: 'Terbuka',
  closed: 'Tertutup',
  all: 'Semua'
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

export function GitHubDialog({ worktreeId, onClose }: { worktreeId: string | null; onClose: () => void }): JSX.Element {
  const [info, setInfo] = useState<GitHubInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pulls');
  const [state, setState] = useState<StateFilter>('open');
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const { push } = useToast();
  const [compose, setCompose] = useState<{
    kind: 'pull' | 'issue';
    number: number;
    mode: 'comment' | 'review' | 'merge';
  } | null>(null);
  const [body, setBody] = useState('');
  const [reviewEvent, setReviewEvent] = useState<'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'>('COMMENT');
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('squash');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadInfo = useCallback(async (): Promise<void> => {
    if (!worktreeId) return;
    setInfoLoading(true);
    setInfoError(null);
    try {
      const response = await apiGet<{ data: GitHubInfo }>(`/github/info?worktreeId=${encodeURIComponent(worktreeId)}`);
      setInfo(response.data);
    } catch (caught) {
      setInfoError(caught instanceof ApiError ? caught.message : 'Gagal memuat info GitHub.');
    } finally {
      setInfoLoading(false);
    }
  }, [worktreeId]);

  useEffect(() => {
    setInfo(null);
    setPulls([]);
    setIssues([]);
    void loadInfo();
  }, [loadInfo]);

  const connected = info?.connected === true && info.repo !== undefined;

  const loadList = useCallback(
    async (nextTab: Tab, nextState: StateFilter): Promise<void> => {
      if (!worktreeId || !connected) return;
      setListLoading(true);
      setListError(null);
      try {
        const response = await apiGet<{ data: Pull[] | Issue[] }>(
          `/github/${nextTab}?worktreeId=${encodeURIComponent(worktreeId)}&state=${nextState}`
        );
        if (nextTab === 'pulls') setPulls(response.data as Pull[]);
        else setIssues(response.data as Issue[]);
      } catch (caught) {
        setListError(caught instanceof ApiError ? caught.message : 'Gagal memuat data GitHub.');
      } finally {
        setListLoading(false);
      }
    },
    [connected, worktreeId]
  );

  useEffect(() => {
    if (!connected) return;
    void loadList(tab, state);
  }, [connected, tab, state, loadList]);

  const list = tab === 'pulls' ? pulls : issues;

  const openCompose = (kind: 'pull' | 'issue', number: number, mode: 'comment' | 'review' | 'merge'): void => {
    setCompose({ kind, number, mode });
    setBody('');
    setReviewEvent('COMMENT');
    setMergeMethod('squash');
    setActionError(null);
  };

  const submitAction = async (): Promise<void> => {
    if (!compose || !worktreeId) return;
    if (compose.mode !== 'merge' && !body.trim()) {
      setActionError('Isi komentar terlebih dahulu.');
      return;
    }
    setPending(true);
    setActionError(null);
    try {
      if (compose.mode === 'comment') {
        await apiPost('/github/comment', {
          worktreeId,
          number: compose.number,
          body,
          kind: compose.kind
        });
        push('success', `Komentar dikirim ke #${compose.number}.`);
      } else if (compose.mode === 'review') {
        await apiPost('/github/review', {
          worktreeId,
          number: compose.number,
          event: reviewEvent,
          body
        });
        push('success', `Review ${reviewEvent.toLowerCase()} dikirim untuk #${compose.number}.`);
      } else {
        await apiPost('/github/merge', {
          worktreeId,
          number: compose.number,
          method: mergeMethod
        });
        push('success', `Pull request #${compose.number} di-merge.`);
        await loadList(tab, state);
      }
      setCompose(null);
      setBody('');
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Aksi GitHub gagal.');
    } finally {
      setPending(false);
    }
  };

  const renderComposer = (kind: 'pull' | 'issue', number: number): JSX.Element | null => {
    if (!compose || compose.kind !== kind || compose.number !== number) return null;
    return (
      <div className="gh-compose">
        {actionError ? <div className="error-banner">{actionError}</div> : null}
        {compose.mode === 'comment' ? (
          <textarea
            className="textarea"
            rows={3}
            placeholder={`Tulis komentar untuk #${number}...`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            autoFocus
          />
        ) : null}
        {compose.mode === 'review' ? (
          <>
            <select
              className="select"
              value={reviewEvent}
              onChange={(event) => setReviewEvent(event.target.value as 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT')}
              aria-label="Jenis review"
            >
              <option value="COMMENT">Comment</option>
              <option value="APPROVE">Approve</option>
              <option value="REQUEST_CHANGES">Request changes</option>
            </select>
            <textarea
              className="textarea"
              rows={3}
              placeholder={reviewEvent === 'APPROVE' ? 'Catatan review (opsional)...' : 'Alasan review...'}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </>
        ) : null}
        {compose.mode === 'merge' ? (
          <>
            <select
              className="select"
              value={mergeMethod}
              onChange={(event) => setMergeMethod(event.target.value as 'merge' | 'squash' | 'rebase')}
              aria-label="Metode merge"
            >
              <option value="merge">Merge commit</option>
              <option value="squash">Squash</option>
              <option value="rebase">Rebase</option>
            </select>
            <p className="hint">Pull request akan di-merge menggunakan token GitHub yang dikonfigurasi.</p>
          </>
        ) : null}
        <div className="gh-compose-actions">
          <button className="btn tiny" onClick={() => setCompose(null)} disabled={pending}>
            Batal
          </button>
          <button className="btn tiny primary" onClick={() => void submitAction()} disabled={pending}>
            {pending
              ? 'Mengirim...'
              : compose.mode === 'comment'
                ? 'Kirim Komentar'
                : compose.mode === 'review'
                  ? 'Kirim Review'
                  : 'Merge Sekarang'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title="GitHub"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {!worktreeId ? <div className="empty">Pilih worktree terlebih dahulu untuk melihat GitHub.</div> : null}

      {worktreeId && infoLoading && !info ? <div className="empty">Memuat info repository...</div> : null}
      {infoError ? <div className="error-banner">{infoError}</div> : null}

      {info && !info.connected ? (
        <div className="gh-empty">
          <div className="gh-empty-title">
            {info.remote ? 'Remote bukan repository GitHub' : 'Repository belum memiliki remote'}
          </div>
          <p className="muted">{info.reason ?? 'Worktree ini tidak terhubung ke repository GitHub.'}</p>
          <div className="kv">
            <span className="k">Remote</span>
            <span className="v mono">{info.remote ?? '—'}</span>
          </div>
          <button className="btn" onClick={() => void loadInfo()} disabled={infoLoading}>
            Periksa Ulang
          </button>
        </div>
      ) : null}

      {info && info.connected && info.repo ? (
        <>
          <div className="gh-head">
            <div className="gh-head-main">
              <div className="gh-title">
                <span className="mono">{info.repo.fullName}</span>
                <span className={`badge ${info.repo.private ? 'stopped' : 'completed'}`}>
                  {info.repo.private ? 'private' : 'public'}
                </span>
              </div>
              <div className="gh-desc">{info.repo.description ?? 'Tanpa deskripsi.'}</div>
              <div className="gh-meta">
                <span>★ {info.repo.stars}</span>
                <span>Issues: {info.repo.openIssuesCount}</span>
                <span>
                  Default branch: <span className="mono">{info.repo.defaultBranch}</span>
                </span>
              </div>
            </div>
            <a className="btn tiny" href={info.repo.htmlUrl} target="_blank" rel="noreferrer">
              Buka di GitHub ↗
            </a>
          </div>

          <div className="gh-tabs">
            <div className="gh-tab-buttons">
              <button className={`gh-tab ${tab === 'pulls' ? 'active' : ''}`} onClick={() => setTab('pulls')}>
                Pull Requests
              </button>
              <button className={`gh-tab ${tab === 'issues' ? 'active' : ''}`} onClick={() => setTab('issues')}>
                Issues
              </button>
            </div>
            <select
              className="select"
              style={{ maxWidth: 140 }}
              value={state}
              onChange={(event) => setState(event.target.value as StateFilter)}
              aria-label="Filter status GitHub"
            >
              {(['open', 'closed', 'all'] as StateFilter[]).map((value) => (
                <option key={value} value={value}>
                  {STATE_LABEL[value]}
                </option>
              ))}
            </select>
          </div>

          {listError ? <div className="error-banner">{listError}</div> : null}
          {listLoading ? <div className="empty">Memuat {tab === 'pulls' ? 'pull request' : 'issue'}...</div> : null}
          {!listLoading && !listError && list.length === 0 ? (
            <div className="empty">Tidak ada {tab === 'pulls' ? 'pull request' : 'issue'} untuk filter ini.</div>
          ) : null}

          {!listLoading && list.length > 0 ? (
            <div className="gh-list">
              {tab === 'pulls'
                ? pulls.map((pull) => (
                    <div key={pull.number} className="gh-item">
                      <div className="gh-item-head">
                        <span className="gh-number">#{pull.number}</span>
                        <a className="gh-item-title" href={pull.htmlUrl} target="_blank" rel="noreferrer">
                          {pull.title}
                        </a>
                        {pull.draft ? <span className="badge stopped">draft</span> : null}
                        <span className={`badge ${pull.state === 'open' ? 'running' : 'completed'}`}>{pull.state}</span>
                      </div>
                      <div className="gh-item-meta">
                        <span>@{pull.author}</span>
                        <span className="mono">
                          {pull.head} → {pull.base}
                        </span>
                        <span>{formatDate(pull.updatedAt)}</span>
                      </div>
                      <div className="gh-actions">
                        <button className="btn tiny" onClick={() => openCompose('pull', pull.number, 'comment')}>
                          Komentar
                        </button>
                        <button className="btn tiny" onClick={() => openCompose('pull', pull.number, 'review')}>
                          Review
                        </button>
                        {pull.state === 'open' ? (
                          <button className="btn tiny" onClick={() => openCompose('pull', pull.number, 'merge')}>
                            Merge
                          </button>
                        ) : null}
                        <a className="btn tiny ghost" href={pull.htmlUrl} target="_blank" rel="noreferrer">
                          Buka ↗
                        </a>
                      </div>
                      {renderComposer('pull', pull.number)}
                    </div>
                  ))
                : issues.map((issue) => (
                    <div key={issue.number} className="gh-item">
                      <div className="gh-item-head">
                        <span className="gh-number">#{issue.number}</span>
                        <a className="gh-item-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
                          {issue.title}
                        </a>
                        <span className={`badge ${issue.state === 'open' ? 'running' : 'completed'}`}>
                          {issue.state}
                        </span>
                      </div>
                      <div className="gh-item-meta">
                        <span>@{issue.author}</span>
                        <span>{formatDate(issue.updatedAt)}</span>
                      </div>
                      {issue.labels.length > 0 ? (
                        <div className="gh-labels">
                          {issue.labels.map((label) => (
                            <span
                              key={label.name}
                              className="gh-label"
                              style={{ borderColor: `#${label.color}`, color: `#${label.color}` }}
                            >
                              {label.name}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="gh-actions">
                        <button className="btn tiny" onClick={() => openCompose('issue', issue.number, 'comment')}>
                          Komentar
                        </button>
                        <a className="btn tiny ghost" href={issue.htmlUrl} target="_blank" rel="noreferrer">
                          Buka ↗
                        </a>
                      </div>
                      {renderComposer('issue', issue.number)}
                    </div>
                  ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
