import { useEffect, useMemo, useState } from 'react';
import type { AgentInfo, SessionHistoryItem } from '@dorado/shared';
import { ApiError, apiGet, copyText } from '../lib/api';
import { Modal, StatusBadge, useToast } from './ui';

interface HistoryResponse {
  data: SessionHistoryItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

type HistoryScope = 'worktree' | 'project' | 'all';
type HistoryGroup = 'none' | 'project' | 'agent';

function resumeCommand(agent: string, info: AgentInfo | undefined): string {
  const parts = info ? [info.command, ...(info.resumeArgs ?? info.args)] : [agent, '--continue'];
  const cleaned = parts.filter((part) => part !== '{{prompt}}' && part !== '--prompt');
  return cleaned.join(' ');
}

export function HistoryDialog({
  onClose,
  onRerun,
  selectedProjectId,
  selectedWorktreeId
}: {
  onClose: () => void;
  onRerun: (session: SessionHistoryItem) => Promise<void>;
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
}): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [agent, setAgent] = useState('');
  const [scope, setScope] = useState<HistoryScope>(
    selectedWorktreeId ? 'worktree' : selectedProjectId ? 'project' : 'all'
  );
  const [group, setGroup] = useState<HistoryGroup>('none');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionHistoryItem | null>(null);
  const [pending, setPending] = useState(false);

  const load = async (search = query, filter = status, agentFilter = agent, nextScope = scope): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (filter) params.set('status', filter);
      if (agentFilter) params.set('agent', agentFilter);
      if (nextScope === 'project' && selectedProjectId) params.set('projectId', selectedProjectId);
      if (nextScope === 'worktree' && selectedWorktreeId) params.set('worktreeId', selectedWorktreeId);
      params.set('page_size', '50');
      const response = await apiGet<HistoryResponse>(`/sessions/history?${params.toString()}`);
      setItems(response.data);
      setSelected((current) => response.data.find((item) => item.id === current?.id) ?? response.data[0] ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat riwayat sesi.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('', '', '', selectedWorktreeId ? 'worktree' : selectedProjectId ? 'project' : 'all');
    apiGet<{ data: AgentInfo[] }>('/agents')
      .then((response) => setAgents(response.data))
      .catch(() => setAgents([]));
    // Muat sekali saat dialog dibuka; filter berikutnya memakai tombol Cari.
  }, []);

  const grouped = useMemo(() => {
    if (group === 'none') return [{ key: 'all', label: '', items }];
    const map = new Map<string, SessionHistoryItem[]>();
    for (const item of items) {
      const key = group === 'project' ? item.projectName : item.agent;
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([key, list]) => ({ key, label: key, items: list }));
  }, [items, group]);

  const rerun = async (): Promise<void> => {
    if (!selected) return;
    setPending(true);
    try {
      await onRerun(selected);
    } finally {
      setPending(false);
    }
  };

  const copy = async (value: string, label: string): Promise<void> => {
    const ok = await copyText(value);
    push(ok ? 'success' : 'error', ok ? `${label} disalin.` : `Gagal menyalin ${label.toLowerCase()}.`);
  };

  const formatDate = (value: string): string => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
  };

  const selectedAgent = agents.find((item) => item.id === selected?.agent);

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
            {pending ? 'Menjalankan...' : selected?.status === 'running' ? 'Sesi masih berjalan' : '↻ Restart Sesi'}
          </button>
        </>
      }
    >
      <form
        className="row history-filters"
        style={{ marginBottom: 12 }}
        onSubmit={(event) => {
          event.preventDefault();
          void load(query, status, agent, scope);
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
          value={scope}
          onChange={(event) => {
            const next = event.target.value as HistoryScope;
            setScope(next);
            void load(query, status, agent, next);
          }}
          aria-label="Scope riwayat"
        >
          <option value="worktree" disabled={!selectedWorktreeId}>
            Worktree aktif
          </option>
          <option value="project" disabled={!selectedProjectId}>
            Project aktif
          </option>
          <option value="all">Semua</option>
        </select>
        <select
          className="select"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            void load(query, event.target.value, agent, scope);
          }}
          aria-label="Filter status"
        >
          <option value="">Semua status</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="stopped">Stopped</option>
        </select>
        <select
          className="select"
          value={agent}
          onChange={(event) => {
            setAgent(event.target.value);
            void load(query, status, event.target.value, scope);
          }}
          aria-label="Filter agent"
        >
          <option value="">Semua agent</option>
          {agents.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={group}
          onChange={(event) => setGroup(event.target.value as HistoryGroup)}
          aria-label="Kelompok riwayat"
        >
          <option value="none">Tanpa grup</option>
          <option value="project">Grup project</option>
          <option value="agent">Grup agent</option>
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
          {grouped.map((section) => (
            <div key={section.key} className="history-group">
              {section.label ? <div className="section-label">{section.label}</div> : null}
              {section.items.map((item) => (
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
                <span className="v mono">{selected.worktreeBranch}</span>
              </div>
              <div className="kv">
                <span className="k">CWD</span>
                <span className="v mono history-path">{selected.worktreePath}</span>
              </div>
              <div className="kv">
                <span className="k">Agent</span>
                <span className="v">
                  {selected.agent}
                  {selectedAgent ? <span className="muted"> · {selectedAgent.name}</span> : null}
                </span>
              </div>
              <div className="kv">
                <span className="k">Dibuat</span>
                <span className="v">{formatDate(selected.createdAt)}</span>
              </div>
              <div className="kv">
                <span className="k">Selesai</span>
                <span className="v">{selected.endedAt ? formatDate(selected.endedAt) : '—'}</span>
              </div>
              <div className="kv">
                <span className="k">Session ID</span>
                <span className="v history-copy-row">
                  <span className="mono history-id">{selected.id}</span>
                  <button className="btn tiny" onClick={() => void copy(selected.id, 'Session ID')}>
                    Salin
                  </button>
                </span>
              </div>
              <div className="kv">
                <span className="k">Resume</span>
                <span className="v history-copy-row">
                  <span className="mono history-id">{resumeCommand(selected.agent, selectedAgent)}</span>
                  <button
                    className="btn tiny"
                    onClick={() => void copy(resumeCommand(selected.agent, selectedAgent), 'Resume command')}
                  >
                    Salin
                  </button>
                </span>
              </div>
              <div className="section-label">Prompt pertama</div>
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
