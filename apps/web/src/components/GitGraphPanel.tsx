import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GitCommitDetail, GitGraph, GitGraphEdge, Project } from '@dorado/shared';
import { ApiError, apiGet } from '../lib/api';

const LANE_WIDTH = 16;
const ROW_HEIGHT = 38;
const LANE_COLORS = ['#6ea8fe', '#f0a35e', '#63d3a6', '#d08bf0', '#f2d45c', '#f07c8e', '#7bdff2', '#b8c4ff'];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? LANE_COLORS[0]!;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp * 1000).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function refLabel(ref: string): { label: string; kind: 'tag' | 'branch' } {
  if (ref.startsWith('tag: ')) return { label: ref.slice(5), kind: 'tag' };
  return { label: ref, kind: 'branch' };
}

function edgePath(edge: GitGraphEdge, maxRows: number): string | null {
  if (edge.from >= maxRows || edge.to >= maxRows) return null;
  const x1 = edge.fromLane * LANE_WIDTH + 12;
  const x2 = edge.toLane * LANE_WIDTH + 12;
  const y1 = edge.from * ROW_HEIGHT + ROW_HEIGHT / 2;
  const y2 = edge.to * ROW_HEIGHT + ROW_HEIGHT / 2;
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

export function GitGraphPanel({ project, onClose }: { project: Project | null; onClose: () => void }): JSX.Element {
  const [graph, setGraph] = useState<GitGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const version = useRef(0);
  const detailVersion = useRef(0);

  const load = useCallback(async () => {
    if (!project) return;
    const id = version.current + 1;
    version.current = id;
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: GitGraph }>(
        `/git/graph?projectId=${encodeURIComponent(project.id)}&limit=${limit}`
      );
      if (version.current !== id) return;
      setGraph(response.data);
    } catch (caught) {
      if (version.current !== id) return;
      setGraph(null);
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat git graph.');
    } finally {
      if (version.current === id) setLoading(false);
    }
  }, [project, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedHash(null);
    setDetail(null);
  }, [project?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectCommit = async (hash: string): Promise<void> => {
    if (!project) return;
    if (selectedHash === hash) {
      detailVersion.current += 1;
      setSelectedHash(null);
      setDetail(null);
      return;
    }
    setSelectedHash(hash);
    setDetail(null);
    setDetailLoading(true);
    const id = detailVersion.current + 1;
    detailVersion.current = id;
    try {
      const response = await apiGet<{ data: GitCommitDetail }>(
        `/git/graph/commit?projectId=${encodeURIComponent(project.id)}&hash=${encodeURIComponent(hash)}`
      );
      if (detailVersion.current !== id) return;
      setDetail(response.data);
    } catch (caught) {
      if (detailVersion.current !== id) return;
      setDetail(null);
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat detail commit.');
    } finally {
      if (detailVersion.current === id) setDetailLoading(false);
    }
  };

  const commits = graph?.commits ?? [];
  const graphWidth = Math.max(42, ((graph?.maxLane ?? 0) + 1) * LANE_WIDTH + 12);
  const canvasHeight = commits.length * ROW_HEIGHT;

  return createPortal(
    <div
      className="orch-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="orch-panel git-graph-panel" role="dialog" aria-modal="true" aria-label="Git Graph">
        <div className="orch-head">
          <h2 style={{ margin: 0, fontSize: 14 }}>Git Graph</h2>
          {project ? (
            <span className="muted" style={{ fontSize: 11.5 }}>
              {project.name}
            </span>
          ) : null}
          <span className="topbar-spacer" />
          <select
            className="input tiny"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            aria-label="Jumlah commit"
          >
            <option value={50}>50 commit</option>
            <option value={100}>100 commit</option>
            <option value={200}>200 commit</option>
            <option value={300}>300 commit</option>
          </select>
          <button className="btn tiny" onClick={() => void load()} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat Ulang'}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup" title="Tutup">
            ×
          </button>
        </div>

        {!project ? <div className="empty">Pilih project terlebih dahulu.</div> : null}
        {project && error ? <div className="error-banner">{error}</div> : null}

        <div className="git-graph-layout">
          <div className="git-graph-scroll">
            {project && commits.length === 0 && !loading ? <div className="empty">Belum ada commit.</div> : null}
            {commits.length > 0 ? (
              <div className="git-graph-inner" style={{ height: canvasHeight }}>
                <svg
                  className="git-graph-svg"
                  width={graphWidth}
                  height={canvasHeight}
                  aria-hidden="true"
                  focusable="false"
                >
                  {(graph?.edges ?? []).map((edge, index) => {
                    const path = edgePath(edge, commits.length);
                    if (!path) return null;
                    return (
                      <path
                        key={`${edge.from}-${edge.to}-${index}`}
                        d={path}
                        fill="none"
                        stroke={laneColor(edge.fromLane)}
                        strokeWidth={1.6}
                        strokeOpacity={0.65}
                      />
                    );
                  })}
                  {commits.map((commit, index) => (
                    <circle
                      key={commit.hash}
                      cx={commit.lane * LANE_WIDTH + 12}
                      cy={index * ROW_HEIGHT + ROW_HEIGHT / 2}
                      r={4}
                      fill={laneColor(commit.lane)}
                      stroke="var(--panel)"
                      strokeWidth={1.5}
                    />
                  ))}
                </svg>
                {commits.map((commit, index) => (
                  <button
                    key={commit.hash}
                    type="button"
                    className={`git-graph-row ${selectedHash === commit.hash ? 'active' : ''}`}
                    style={{ paddingLeft: graphWidth + 4, top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onClick={() => void selectCommit(commit.hash)}
                    title={`${commit.shortHash} · ${commit.subject}`}
                  >
                    <span className="git-graph-subject">{commit.subject || '(tanpa pesan)'}</span>
                    <span className="git-graph-refs">
                      {commit.refs.map((ref) => {
                        const info = refLabel(ref);
                        return (
                          <span key={ref} className={`git-ref ${info.kind}`}>
                            {info.label}
                          </span>
                        );
                      })}
                    </span>
                    <span className="git-graph-meta">
                      {commit.author} · {formatDate(commit.timestamp)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {graph?.truncated ? (
              <div className="git-graph-truncated">
                Riwayat dipotong. Naikkan jumlah commit untuk melihat lebih banyak.
              </div>
            ) : null}
          </div>

          <aside className="git-graph-detail">
            {!selectedHash ? (
              <div className="empty">Klik commit untuk melihat detail.</div>
            ) : detailLoading ? (
              <div className="empty">Memuat detail commit...</div>
            ) : detail ? (
              <>
                <div className="git-commit-title">{detail.subject || '(tanpa pesan)'}</div>
                <div className="git-commit-meta">
                  <span className="mono">{detail.shortHash}</span>
                  <span>{detail.author}</span>
                  <span>{formatDate(detail.timestamp)}</span>
                </div>
                {detail.body ? <pre className="git-commit-body">{detail.body}</pre> : null}
                <div className="git-commit-files-title">{detail.files.length} file berubah</div>
                <div className="git-commit-files">
                  {detail.files.map((file) => (
                    <div className="git-commit-file" key={`${file.status}:${file.path}`}>
                      <span className={`git-file-status status-${file.status.charAt(0)}`}>{file.status}</span>
                      <span className="mono">{file.path}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">Detail tidak tersedia.</div>
            )}
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
}
