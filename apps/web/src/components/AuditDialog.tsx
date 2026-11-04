import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry } from '@dorado/shared';
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from '@dorado/shared';
import { ApiError, apiGet } from '../lib/api';
import { Modal } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

function actionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action as keyof typeof AUDIT_ACTION_LABELS] ?? action;
}

export function AuditDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (action) params.set('action', action);
      if (appliedQuery) params.set('q', appliedQuery);
      const response = await apiGet<{ data: AuditEntry[]; meta: { total: number } }>(`/audit?${params.toString()}`);
      setEntries(response.data);
      setTotal(response.meta.total);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat audit log.'));
    } finally {
      setLoading(false);
    }
  }, [action, appliedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal
      title="Audit Log"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="orch-toolbar">
        <select
          className="select"
          style={{ maxWidth: 200 }}
          value={action}
          onChange={(event) => setAction(event.target.value)}
          aria-label="Filter aksi audit"
        >
          <option value="">Semua aksi</option>
          {AUDIT_ACTIONS.map((item) => (
            <option key={item} value={item}>
              {AUDIT_ACTION_LABELS[item]}
            </option>
          ))}
        </select>
        <form
          className="row"
          style={{ flex: 1 }}
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedQuery(query.trim());
          }}
        >
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari username atau detail..."
            aria-label="Cari audit log"
          />
          <button className="btn tiny" type="submit" disabled={loading}>
            Cari
          </button>
        </form>
        <button className="btn tiny" onClick={() => void load()} disabled={loading}>
          Muat Ulang
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      <div className="muted" style={{ fontSize: 10.5, marginBottom: 8 }}>
        Menampilkan {entries.length} dari {total} entri.
      </div>

      <div className="orch-table-wrap">
        <table className="orch-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>User</th>
              <th>Aksi</th>
              <th>Target</th>
              <th>Detail</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td className="mono">{entry.username ?? '—'}</td>
                <td>{actionLabel(entry.action)}</td>
                <td className="mono">{entry.targetType ? `${entry.targetType}:${entry.targetId ?? '—'}` : '—'}</td>
                <td className="orch-ellipsis" title={entry.detail ?? ''}>
                  {entry.detail ?? '—'}
                </td>
                <td className="mono">{entry.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 ? <div className="empty">Belum ada audit log.</div> : null}
      </div>
    </Modal>
  );
}

export default AuditDialog;
