import { useEffect, useState } from 'react';
import type { SessionHistoryItem } from '@dorado/shared';
import { ApiError, apiGet } from '../lib/api';
import { Modal, StatusBadge } from './ui';

interface HistoryResponse {
  data: SessionHistoryItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function HistoryDialog({
  onClose,
  onRerun
}: {
  onClose: () => void;
  onRerun: (session: SessionHistoryItem) => Promise<void>;
}): JSX.Element {
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionHistoryItem | null>(null);
  const [pending, setPending] = useState(false);

  const load = async (search = query, filter = status): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (filter) params.set('status', filter);
      params.set('page_size', '50');
      const response = await apiGet<HistoryResponse>(`/sessions/history?${params.toString()}`);
      setItems(response.data);
      setSelected((current) => current ?? response.data[0] ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat riwayat sesi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('', '');
  }, []);

  const rerun = async (): Promise<void> => {
    if (!selected) return;
    setPending(true);
    try {
      await onRerun(selected);
    } finally {
      setPending(false);
    }
  };

  const formatDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
  };

  return (
    <Modal
      title="Riwayat Sesi Agent"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>
            Tutup
          </button>
          <button
            className="btn primary"
            onClick={() => void rerun()}
            disabled={!selected || pending || selected.status === 'running'}
          >
            {pending ? 'Menjalankan...' : selected?.status === 'running' ? 'Sesi masih berjalan' : 'Rerun Sesi'}
          </button>
        </>
      }
    >
      <form
        className="row"
        style={{ marginBottom: 12 }}
        onSubmit={(event) => {
          event.preventDefault();
          void load(query, status);
        }}
      >
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari judul atau prompt..."
          aria-label="Cari riwayat sesi"
        />
        <select
          className="select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            void load(query, event.target.value);
          }}
          style={{ maxWidth: 150 }}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>
        <button className="btn" type="submit" disabled={loading}>
          Cari
        </button>
      </form>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="history-layout">
        <div className="history-list">
          {loading ? <div className="empty">Memuat riwayat...</div> : null}
          {!loading && items.length === 0 ? <div className="empty">Belum ada sesi yang cocok.</div> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`history-item ${selected?.id === item.id ? 'active' : ''}`}
              onClick={() => setSelected(item)}
            >
              <span className="history-title">{item.title}</span>
              <span className="history-meta">
                {item.projectName} · <span className="mono">{item.worktreeBranch}</span>
              </span>
              <span className="history-meta">
                {item.agent} · {formatDate(item.createdAt)}
              </span>
              <StatusBadge status={item.status} />
            </button>
          ))}
        </div>

        <div className="history-detail">
          {selected ? (
            <>
              <div className="kv">
                <span className="k">Status</span>
                <span className="v">
                  <StatusBadge status={selected.status} />
                </span>
              </div>
              <div className="kv">
                <span className="k">Project</span>
                <span className="v">{selected.projectName}</span>
              </div>
              <div className="kv">
                <span className="k">Worktree</span>
                <span className="v">{selected.worktreeBranch}</span>
              </div>
              <div className="kv">
                <span className="k">Agent</span>
                <span className="v">{selected.agent}</span>
              </div>
              <div className="kv">
                <span className="k">Dibuat</span>
                <span className="v">{formatDate(selected.createdAt)}</span>
              </div>
              <div className="kv">
                <span className="k">Selesai</span>
                <span className="v">{selected.endedAt ? formatDate(selected.endedAt) : '—'}</span>
              </div>
              <div className="section-label">Prompt</div>
              <pre className="history-prompt">{selected.prompt || '—'}</pre>
            </>
          ) : (
            <div className="empty">Pilih sesi untuk melihat detail.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
