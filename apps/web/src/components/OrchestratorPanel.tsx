import { useCallback, useEffect, useState } from 'react';
import type { OrchAgent, OrchDashboardSummary, OrchProvider, OrchTask, OrchTaskLog } from '@dorado/shared';
import {
  ORCH_PROVIDER_TYPES,
  ORCH_PROVIDER_TYPE_LABELS,
  ORCH_TASK_STATUSES,
  ORCH_TASK_STATUS_LABELS
} from '@dorado/shared';
import { ApiError, apiGet, copyText, request } from '../lib/api';
import { useToast } from './ui';

type Tab = 'dashboard' | 'providers' | 'agents' | 'tasks';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'providers', label: 'Provider' },
  { id: 'agents', label: 'Agent' },
  { id: 'tasks', label: 'Task' }
];

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

function OrchBadge({ status }: { status: string }): JSX.Element {
  return <span className={`badge ${status.toLowerCase()}`}>{status}</span>;
}

/* ------------------------------- dashboard ------------------------------- */

function DashboardTab(): JSX.Element {
  const [summary, setSummary] = useState<OrchDashboardSummary | null>(null);
  const [mode, setMode] = useState<'connecting' | 'stream' | 'polling'>('connecting');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<{ data: OrchDashboardSummary }>('/orchestrator/summary');
      setSummary(response.data);
      setError(null);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat ringkasan orchestrator.'));
    }
  }, []);

  useEffect(() => {
    void load();
    let source: EventSource | null = null;
    let poll: number | undefined;
    const startPolling = (): void => {
      setMode('polling');
      if (poll !== undefined) return;
      poll = window.setInterval(() => void load(), 2000);
    };

    try {
      source = new EventSource('/api/orchestrator/events');
      source.onopen = () => setMode('stream');
      source.addEventListener('summary', (event) => {
        try {
          setSummary(JSON.parse((event as MessageEvent).data) as OrchDashboardSummary);
          setMode('stream');
          setError(null);
        } catch {
          // abaikan payload rusak
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      source?.close();
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, [load]);

  return (
    <div>
      <div className="orch-toolbar">
        <span className="muted" style={{ fontSize: 11 }}>
          {mode === 'stream' ? 'Realtime SSE aktif' : mode === 'polling' ? 'Mode polling 2 detik' : 'Menghubungkan...'}
        </span>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => void load()}>
          Muat Ulang
        </button>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="orch-cards">
        <div className="orch-card">
          <span className="orch-card-label">Agent Aktif</span>
          <span className="orch-card-value">{summary?.agentsActive ?? '—'}</span>
        </div>
        <div className="orch-card">
          <span className="orch-card-label">Task Berjalan</span>
          <span className="orch-card-value">{summary?.tasksRunning ?? '—'}</span>
        </div>
        <div className="orch-card">
          <span className="orch-card-label">Task Gagal Hari Ini</span>
          <span className="orch-card-value">{summary?.tasksFailedToday ?? '—'}</span>
        </div>
        <div className="orch-card">
          <span className="orch-card-label">Biaya Hari Ini</span>
          <span className="orch-card-value">${summary?.costTodayUsd ?? '0.0000'}</span>
        </div>
      </div>

      <div className="orch-columns">
        <section className="orch-section">
          <h3>Peringatan</h3>
          {summary && summary.alerts.length === 0 ? <div className="empty">Tidak ada peringatan.</div> : null}
          <div className="orch-list">
            {summary?.alerts.map((alert) => (
              <div className="orch-alert" key={`${alert.type}:${alert.id}`}>
                <OrchBadge status={alert.type === 'AGENT_OFFLINE' ? 'OFFLINE' : 'FAILED'} />
                <span className="mono">{alert.label}</span>
                <span className="muted">{formatDate(alert.since)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="orch-section">
          <h3>Aktivitas Terbaru</h3>
          {summary && summary.recentLogs.length === 0 ? <div className="empty">Belum ada aktivitas.</div> : null}
          <div className="orch-list">
            {summary?.recentLogs.map((log) => (
              <div className="orch-log" key={log.id}>
                <OrchBadge status={log.logLevel} />
                <span className="mono">{log.taskCode}</span>
                <span className="orch-log-message">{log.message}</span>
                <span className="muted">{formatDate(log.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------- providers ------------------------------- */

function ProvidersTab(): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<OrchProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState('LITELLM');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [costPer1kTokens, setCostPer1kTokens] = useState('0.0020');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: OrchProvider[] }>('/orchestrator/providers?pageSize=100');
      setItems(response.data);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat provider.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await request('/orchestrator/providers', {
        method: 'POST',
        body: { name, providerType, baseUrl, apiKey, defaultModel, costPer1kTokens }
      });
      push('success', 'Provider disimpan.');
      setFormOpen(false);
      setName('');
      setBaseUrl('');
      setApiKey('');
      setDefaultModel('');
      await load();
    } catch (caught) {
      setError(messageOf(caught, 'Gagal menyimpan provider.'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (provider: OrchProvider): Promise<void> => {
    try {
      await request(`/orchestrator/providers/${provider.id}`, {
        method: 'PATCH',
        body: { isActive: !provider.isActive }
      });
      await load();
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal mengubah provider.'));
    }
  };

  return (
    <div>
      <div className="orch-toolbar">
        <button className="btn tiny primary" onClick={() => setFormOpen((value) => !value)}>
          {formOpen ? 'Tutup Form' : '+ Provider'}
        </button>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => void load()} disabled={loading}>
          Muat Ulang
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {formOpen ? (
        <form
          className="orch-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Nama
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Tipe
            <select className="select" value={providerType} onChange={(event) => setProviderType(event.target.value)}>
              {ORCH_PROVIDER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ORCH_PROVIDER_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Base URL
            <input
              className="input"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://..."
              required
            />
          </label>
          <label>
            Model Default
            <input
              className="input"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
              required
            />
          </label>
          <label>
            API Key
            <input
              className="input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
            />
          </label>
          <label>
            Tarif / 1K Token (USD)
            <input
              className="input"
              value={costPer1kTokens}
              onChange={(event) => setCostPer1kTokens(event.target.value)}
              required
            />
          </label>
          <div className="orch-form-actions">
            <button className="btn tiny primary" type="submit" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Provider'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="orch-table-wrap">
        <table className="orch-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Tipe</th>
              <th>Model</th>
              <th>Tarif</th>
              <th>API Key</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((provider) => (
              <tr key={provider.id}>
                <td>{provider.name}</td>
                <td>{ORCH_PROVIDER_TYPE_LABELS[provider.providerType]}</td>
                <td className="mono">{provider.defaultModel}</td>
                <td className="mono">${provider.costPer1kTokens}</td>
                <td className="mono">••••{provider.apiKeyLast4 ?? '????'}</td>
                <td>
                  <OrchBadge status={provider.isActive ? 'ACTIVE' : 'INACTIVE'} />
                </td>
                <td>
                  <button className="btn tiny" onClick={() => void toggle(provider)}>
                    {provider.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? <div className="empty">Belum ada provider.</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- agents -------------------------------- */

function AgentsTab(): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<OrchAgent[]>([]);
  const [providers, setProviders] = useState<OrchProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [providerId, setProviderId] = useState('');
  const [maxConcurrency, setMaxConcurrency] = useState('1');
  const [token, setToken] = useState<{ label: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [agentResponse, providerResponse] = await Promise.all([
        apiGet<{ data: OrchAgent[] }>('/orchestrator/agents?pageSize=100'),
        apiGet<{ data: OrchProvider[] }>('/orchestrator/providers?pageSize=100')
      ]);
      setItems(agentResponse.data);
      setProviders(providerResponse.data.filter((provider) => provider.isActive));
      setProviderId((current) => current || String(providerResponse.data[0]?.id ?? ''));
      setError(null);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat agent.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await request<{ data: OrchAgent; agentToken: string }>('/orchestrator/agents', {
        method: 'POST',
        body: { code, name, endpointUrl, providerId: Number(providerId), maxConcurrency: Number(maxConcurrency) }
      });
      setToken({ label: `Token untuk ${response.data.code}`, value: response.agentToken });
      push('success', 'Agent didaftarkan. Simpan token sekarang.');
      setFormOpen(false);
      setCode('');
      setName('');
      setEndpointUrl('');
      await load();
    } catch (caught) {
      setError(messageOf(caught, 'Gagal mendaftarkan agent.'));
    } finally {
      setSaving(false);
    }
  };

  const rotate = async (agent: OrchAgent): Promise<void> => {
    try {
      const response = await request<{ agentToken: string }>(`/orchestrator/agents/${agent.id}/rotate-token`, {
        method: 'POST'
      });
      setToken({ label: `Token baru untuk ${agent.code}`, value: response.agentToken });
      push('success', 'Token agent diperbarui.');
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal merotasi token.'));
    }
  };

  const toggle = async (agent: OrchAgent): Promise<void> => {
    try {
      await request(`/orchestrator/agents/${agent.id}`, {
        method: 'PATCH',
        body: { isActive: !agent.isActive }
      });
      await load();
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal mengubah agent.'));
    }
  };

  return (
    <div>
      <div className="orch-toolbar">
        <button className="btn tiny primary" onClick={() => setFormOpen((value) => !value)}>
          {formOpen ? 'Tutup Form' : '+ Agent'}
        </button>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => void load()}>
          Muat Ulang
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {token ? (
        <div className="orch-token">
          <div>
            <strong>{token.label}</strong>
            <div className="muted">Token hanya ditampilkan sekali. Simpan di tempat aman.</div>
            <code className="mono">{token.value}</code>
          </div>
          <button
            className="btn tiny"
            onClick={() => {
              void copyText(token.value).then((ok) =>
                push(ok ? 'success' : 'error', ok ? 'Token disalin.' : 'Gagal menyalin token.')
              );
            }}
          >
            Salin
          </button>
          <button className="btn tiny ghost" onClick={() => setToken(null)}>
            Tutup
          </button>
        </div>
      ) : null}

      {formOpen ? (
        <form
          className="orch-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Kode
            <input
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="AGT-CODER-01"
              required
            />
          </label>
          <label>
            Nama
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label>
            Endpoint URL
            <input
              className="input"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              placeholder="http://127.0.0.1:9101"
              required
            />
          </label>
          <label>
            Provider
            <select
              className="select"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              required
            >
              <option value="">Pilih provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Max Concurrency
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={maxConcurrency}
              onChange={(event) => setMaxConcurrency(event.target.value)}
              required
            />
          </label>
          <div className="orch-form-actions">
            <button className="btn tiny primary" type="submit" disabled={saving || !providerId}>
              {saving ? 'Menyimpan...' : 'Daftarkan Agent'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="orch-table-wrap">
        <table className="orch-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Provider</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th>Task</th>
              <th>Heartbeat</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {items.map((agent) => (
              <tr key={agent.id}>
                <td className="mono">{agent.code}</td>
                <td>{agent.name}</td>
                <td>{agent.providerName ?? '—'}</td>
                <td className="mono orch-ellipsis">{agent.endpointUrl}</td>
                <td>
                  <OrchBadge status={agent.status} />
                </td>
                <td className="mono">
                  {agent.activeTasksCount}/{agent.maxConcurrency}
                </td>
                <td>{formatDate(agent.lastHeartbeatAt)}</td>
                <td className="orch-actions">
                  <button className="btn tiny" onClick={() => void rotate(agent)}>
                    Rotasi Token
                  </button>
                  <button className="btn tiny" onClick={() => void toggle(agent)}>
                    {agent.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <div className="empty">Belum ada agent.</div> : null}
      </div>
    </div>
  );
}

/* --------------------------------- tasks --------------------------------- */

function TasksTab(): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<OrchTask[]>([]);
  const [providers, setProviders] = useState<OrchProvider[]>([]);
  const [agents, setAgents] = useState<OrchAgent[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [priority, setPriority] = useState('2');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<OrchTask | null>(null);
  const [logs, setLogs] = useState<OrchTaskLog[]>([]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      if (status) params.set('status', status);
      const [taskResponse, providerResponse, agentResponse] = await Promise.all([
        apiGet<{ data: OrchTask[] }>(`/orchestrator/tasks?${params.toString()}`),
        apiGet<{ data: OrchProvider[] }>('/orchestrator/providers?pageSize=100'),
        apiGet<{ data: OrchAgent[] }>('/orchestrator/agents?pageSize=100')
      ]);
      setItems(taskResponse.data);
      setProviders(providerResponse.data.filter((provider) => provider.isActive));
      setAgents(agentResponse.data.filter((agent) => agent.isActive));
      setProviderId((current) => current || String(providerResponse.data[0]?.id ?? ''));
      setAgentId((current) => current || String(agentResponse.data[0]?.id ?? ''));
      setError(null);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat task.'));
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (task: OrchTask): Promise<void> => {
    try {
      const [taskResponse, logResponse] = await Promise.all([
        apiGet<{ data: OrchTask }>(`/orchestrator/tasks/${task.id}`),
        apiGet<{ data: OrchTaskLog[] }>(`/orchestrator/tasks/${task.id}/logs?limit=100`)
      ]);
      setSelected(taskResponse.data);
      setLogs(logResponse.data);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal memuat detail task.'));
    }
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    if (selected.status !== 'QUEUED' && selected.status !== 'RUNNING') return undefined;
    const timer = window.setInterval(() => {
      void loadDetail(selected);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selected, loadDetail]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await request<{ data: OrchTask }>('/orchestrator/tasks', {
        method: 'POST',
        body: {
          title,
          prompt,
          agentId: Number(agentId),
          providerId: Number(providerId),
          priority: Number(priority)
        }
      });
      push('success', `Task ${response.data.code} masuk antrean.`);
      setFormOpen(false);
      setTitle('');
      setPrompt('');
      await load();
      await loadDetail(response.data);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal membuat task.'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (task: OrchTask): Promise<void> => {
    const reason = window.prompt('Alasan pembatalan (minimal 5 karakter):');
    if (!reason || reason.trim().length < 5) return;
    try {
      await request(`/orchestrator/tasks/${task.id}/cancel`, { method: 'POST', body: { reason: reason.trim() } });
      push('success', 'Task dibatalkan.');
      await load();
      await loadDetail(task);
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal membatalkan task.'));
    }
  };

  const retry = async (task: OrchTask): Promise<void> => {
    try {
      const response = await request<{ data: OrchTask }>(`/orchestrator/tasks/${task.id}/retry`, { method: 'POST' });
      push('success', `Task retry ${response.data.code} dibuat.`);
      await load();
      await loadDetail(response.data);
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal menjalankan ulang task.'));
    }
  };

  return (
    <div>
      <div className="orch-toolbar">
        <button className="btn tiny primary" onClick={() => setFormOpen((value) => !value)}>
          {formOpen ? 'Tutup Form' : '+ Task'}
        </button>
        <select
          className="select"
          style={{ maxWidth: 160 }}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter status task"
        >
          <option value="">Semua status</option>
          {ORCH_TASK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ORCH_TASK_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => void load()}>
          Muat Ulang
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {formOpen ? (
        <form
          className="orch-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Judul
            <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label>
            Agent
            <select className="select" value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
              <option value="">Pilih agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.code} · {agent.status}
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider
            <select
              className="select"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              required
            >
              <option value="">Pilih provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioritas
            <select className="select" value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="1">Rendah</option>
              <option value="2">Normal</option>
              <option value="3">Tinggi</option>
            </select>
          </label>
          <label className="orch-form-full">
            Prompt
            <textarea
              className="input"
              rows={4}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
            />
          </label>
          <div className="orch-form-actions">
            <button className="btn tiny primary" type="submit" disabled={saving || !agentId || !providerId}>
              {saving ? 'Mengirim...' : 'Buat Task'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="orch-table-wrap">
        <table className="orch-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Judul</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Provider</th>
              <th>Token</th>
              <th>Biaya</th>
              <th>Dibuat</th>
            </tr>
          </thead>
          <tbody>
            {items.map((task) => (
              <tr
                key={task.id}
                className={selected?.id === task.id ? 'active' : ''}
                onClick={() => void loadDetail(task)}
              >
                <td className="mono">{task.code}</td>
                <td>{task.title}</td>
                <td>
                  <OrchBadge status={task.status} />
                </td>
                <td>{task.agentCode ?? '—'}</td>
                <td>{task.providerName ?? '—'}</td>
                <td className="mono">{task.tokenUsed}</td>
                <td className="mono">${task.costUsd}</td>
                <td>{formatDate(task.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <div className="empty">Belum ada task.</div> : null}
      </div>

      {selected ? (
        <section className="orch-detail">
          <div className="orch-detail-head">
            <div>
              <strong className="mono">{selected.code}</strong>
              <span className="muted"> · {selected.title}</span>
            </div>
            <span className="spacer" />
            {selected.status === 'QUEUED' || selected.status === 'RUNNING' ? (
              <button className="btn tiny" onClick={() => void cancel(selected)}>
                Batalkan
              </button>
            ) : null}
            {selected.status === 'FAILED' || selected.status === 'CANCELLED' ? (
              <button className="btn tiny primary" onClick={() => void retry(selected)}>
                Retry
              </button>
            ) : null}
          </div>
          <div className="orch-detail-grid">
            <div className="kv">
              <span className="k">Status</span>
              <span className="v">
                <OrchBadge status={selected.status} />
              </span>
            </div>
            <div className="kv">
              <span className="k">Agent / Provider</span>
              <span className="v">
                {selected.agentCode ?? '—'} / {selected.providerName ?? '—'}
              </span>
            </div>
            <div className="kv">
              <span className="k">Token / Biaya</span>
              <span className="v mono">
                {selected.tokenUsed} / ${selected.costUsd}
              </span>
            </div>
            <div className="kv">
              <span className="k">Mulai / Selesai</span>
              <span className="v">
                {formatDate(selected.startedAt)} / {formatDate(selected.finishedAt)}
              </span>
            </div>
          </div>
          <div className="section-label">Prompt</div>
          <pre className="history-prompt">{selected.prompt}</pre>
          {selected.result ? (
            <>
              <div className="section-label">Hasil</div>
              <pre className="history-prompt">{selected.result}</pre>
            </>
          ) : null}
          {selected.errorMessage ? (
            <>
              <div className="section-label">Error</div>
              <pre className="history-prompt">{selected.errorMessage}</pre>
            </>
          ) : null}
          <div className="orch-detail-head">
            <div className="section-label">Log</div>
            <span className="spacer" />
            <button
              className="btn tiny"
              onClick={() => {
                const text = logs
                  .map((log) => `[${formatDate(log.createdAt)}] ${log.logLevel} ${log.actorType}: ${log.message}`)
                  .join('\n');
                void copyText(text).then((ok) =>
                  push(ok ? 'success' : 'error', ok ? 'Log disalin.' : 'Gagal menyalin log.')
                );
              }}
            >
              Salin Log
            </button>
          </div>
          <div className="orch-logs">
            {logs.length === 0 ? <div className="empty">Belum ada log.</div> : null}
            {logs.map((log) => (
              <div className="orch-log-row" key={log.id}>
                <span className="muted mono">{formatDate(log.createdAt)}</span>
                <OrchBadge status={log.logLevel} />
                <span className="muted">{log.actorType}</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------- panel --------------------------------- */

export default function OrchestratorPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="orch-overlay" role="dialog" aria-modal="true" aria-label="Orchestrator">
      <div className="orch-panel">
        <div className="orch-head">
          <span className="brand-mark">O</span>
          <strong>Orchestrator</strong>
          <div className="orch-tabs">
            {TABS.map((item) => (
              <button
                key={item.id}
                className={`orch-tab ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Tutup">
            ×
          </button>
        </div>
        <div className="orch-body">
          {tab === 'dashboard' ? <DashboardTab /> : null}
          {tab === 'providers' ? <ProvidersTab /> : null}
          {tab === 'agents' ? <AgentsTab /> : null}
          {tab === 'tasks' ? <TasksTab /> : null}
        </div>
      </div>
    </div>
  );
}
