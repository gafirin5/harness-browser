import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';
import { Modal } from './ui';

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

export function GitHubDialog({
  worktreeId,
  onClose
}: {
  worktreeId: string | null;
  onClose: () => void;
}): JSX.Element {
  const [info, setInfo] = useState<GitHubInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pulls');
  const [state, setState] = useState<StateFilter>('open');
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const loadInfo = useCallback(async (): Promise<void> => {
    if (!worktreeId) return;
    setInfoLoading(true);
    setInfoError(null);
    try {
      const response = await apiGet<{ data: GitHubInfo }>(
        `/github/info?worktreeId=${encodeURIComponent(worktreeId)}`
      );
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
          <p className="muted">
            {info.reason ?? 'Worktree ini tidak terhubung ke repository GitHub.'}
          </p>
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
              <button
                className={`gh-tab ${tab === 'pulls' ? 'active' : ''}`}
                onClick={() => setTab('pulls')}
              >
                Pull Requests
              </button>
              <button
                className={`gh-tab ${tab === 'issues' ? 'active' : ''}`}
                onClick={() => setTab('issues')}
              >
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
                    <a
                      key={pull.number}
                      className="gh-item"
                      href={pull.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="gh-item-head">
                        <span className="gh-number">#{pull.number}</span>
                        <span className="gh-item-title">{pull.title}</span>
                        {pull.draft ? <span className="badge stopped">draft</span> : null}
                        <span className={`badge ${pull.state === 'open' ? 'running' : 'completed'}`}>
                          {pull.state}
                        </span>
                      </div>
                      <div className="gh-item-meta">
                        <span>@{pull.author}</span>
                        <span className="mono">
                          {pull.head} → {pull.base}
                        </span>
                        <span>{formatDate(pull.updatedAt)}</span>
                      </div>
                    </a>
                  ))
                : issues.map((issue) => (
                    <a
                      key={issue.number}
                      className="gh-item"
                      href={issue.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <div className="gh-item-head">
                        <span className="gh-number">#{issue.number}</span>
                        <span className="gh-item-title">{issue.title}</span>
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
                    </a>
                  ))}
            </div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}