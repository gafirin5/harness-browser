import { useEffect, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';

export function DiffViewer({
  worktreeId,
  filePath,
  initialStaged
}: {
  worktreeId: string;
  filePath: string;
  initialStaged: boolean;
}): JSX.Element {
  const [staged, setStaged] = useState(initialStaged);
  const [diff, setDiff] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const lines = diff.split('\n');

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
          {truncated ? 'diff dipotong 500 KB' : ''}
        </span>
      </div>
      {error ? <div className="error-banner" style={{ margin: 10 }}>{error}</div> : null}
      {loading ? (
        <div className="empty">Memuat diff...</div>
      ) : !diff ? (
        <div className="empty">Tidak ada perubahan pada mode {staged ? 'staged' : 'unstaged'}.</div>
      ) : (
        <pre className="diff-view" aria-label={`Diff ${filePath}`}>
          {lines.map((line, index) => {
            let className = 'diff-line';
            if (line.startsWith('@@')) className += ' hunk';
            else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
              className += ' meta';
            } else if (line.startsWith('+')) className += ' add';
            else if (line.startsWith('-')) className += ' del';
            return (
              <div key={index} className={className}>
                {line || ' '}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}