import { useCallback, useEffect, useState } from 'react';
import type { AgentInfo, Automation, AutomationRun, Project, Worktree } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { Modal, StatusBadge, useToast } from './ui';

const SCHEDULES = [
  { value: 'manual', label: 'Manual' },
  { value: '5m', label: 'Setiap 5 menit' },
  { value: '15m', label: 'Setiap 15 menit' },
  { value: '30m', label: 'Setiap 30 menit' },
  { value: '1h', label: 'Setiap 1 jam' },
  { value: '6h', label: 'Setiap 6 jam' },
  { value: '24h', label: 'Setiap 24 jam' }
];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('id-ID');
}

export function AutomationsDialog({
  project,
  worktrees,
  onClose,
  onRan
}: {
  project: Project | null;
  worktrees: Worktree[];
  onClose: () => void;
  onRan: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('1h');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState('');
  const [worktreeId, setWorktreeId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = project ? `?projectId=${encodeURIComponent(project.id)}` : '';
      const response = await apiGet<{ data: Automation[] }>(`/automations${query}`);
      setAutomations(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat otomasi.');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
    apiGet<{ data: AgentInfo[] }>('/agents')
      .then((response) => {
        const installed = response.data.filter((item) => item.installed);
        setAgents(installed);
        setAgent((current) => current || installed[0]?.id || '');
      })
      .catch(() => setAgents([]));
  }, [load]);

  const resetForm = (): void => {
    setName('');
    setSchedule('1h');
    setPrompt('');
    setWorktreeId('');
    setEnabled(true);
    setEditingId(null);
  };

  const save = async (): Promise<void> => {
    if (!project) {
      setError('Pilih project terlebih dahulu.');
      return;
    }
    if (!name.trim() || !prompt.trim() || !agent) {
      setError('Nama, prompt, dan agent wajib diisi.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        schedule,
        prompt,
        agent,
        worktreeId: worktreeId || null,
        enabled
      };
      if (editingId) {
        await apiPatch<{ data: Automation }>(`/automations/${editingId}`, payload);
        push('success', 'Otomasi diperbarui.');
      } else {
        await apiPost<{ data: Automation }>('/automations', { ...payload, projectId: project.id });
        push('success', 'Otomasi dibuat.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan otomasi.');
    } finally {
      setPending(false);
    }
  };

  const toggle = async (item: Automation): Promise<void> => {
    try {
      await apiPatch(`/automations/${item.id}`, { enabled: !item.enabled });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengubah status otomasi.');
    }
  };

  const remove = async (item: Automation): Promise<void> => {
    if (!window.confirm(`Hapus otomasi "${item.name}"?`)) return;
    try {
      await apiDelete(`/automations/${item.id}`);
      push('success', 'Otomasi dihapus.');
      if (editingId === item.id) resetForm();
      if (runsFor === item.id) setRunsFor(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus otomasi.');
    }
  };

  const runNow = async (item: Automation): Promise<void> => {
    setRunningId(item.id);
    setError(null);
    try {
      await apiPost(`/automations/${item.id}/run`);
      push('success', `Otomasi "${item.name}" dijalankan.`);
      onRan();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menjalankan otomasi.');
    } finally {
      setRunningId(null);
    }
  };

  const showRuns = async (item: Automation): Promise<void> => {
    if (runsFor === item.id) {
      setRunsFor(null);
      return;
    }
    setRunsFor(item.id);
    setRuns([]);
    try {
      const response = await apiGet<{ data: AutomationRun[] }>(`/automations/${item.id}/runs`);
      setRuns(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat riwayat otomasi.');
    }
  };

  const edit = (item: Automation): void => {
    setEditingId(item.id);
    setName(item.name);
    setSchedule(item.schedule);
    setPrompt(item.prompt);
    setAgent(item.agent);
    setWorktreeId(item.worktreeId ?? '');
    setEnabled(item.enabled);
  };

  const branchFor = (item: Automation): string =>
    worktrees.find((worktree) => worktree.id === item.worktreeId)?.branch ?? 'worktree pertama';

  return (
    <Modal
      title="Scheduled Automations"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Jalankan prompt agent sesuai jadwal. Scheduler berjalan di runtime dan membuat sesi agent baru setiap kali
        otomasi dieksekusi.
      </p>
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="automation-form">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Nama otomasi"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
          <input
            className="input"
            list="automation-schedules"
            placeholder="Jadwal (1h / */15 * * * *)"
            value={schedule}
            onChange={(event) => setSchedule(event.target.value)}
            aria-label="Jadwal otomasi"
            maxLength={100}
          />
          <datalist id="automation-schedules">
            {SCHEDULES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </datalist>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="input"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            aria-label="Agent otomasi"
          >
            {agents.length === 0 ? <option value="">Tidak ada agent</option> : null}
            {agents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={worktreeId}
            onChange={(event) => setWorktreeId(event.target.value)}
            aria-label="Worktree otomasi"
          >
            <option value="">Worktree pertama project</option>
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch}
              </option>
            ))}
          </select>
          <label className="automation-enabled">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Aktif
          </label>
        </div>
        <textarea
          className="textarea"
          rows={3}
          placeholder="Prompt yang dijalankan agent..."
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          maxLength={20000}
        />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {editingId ? (
            <button className="btn tiny" onClick={resetForm} disabled={pending}>
              Batal Edit
            </button>
          ) : null}
          <button className="btn tiny primary" onClick={() => void save()} disabled={pending || !project}>
            {pending ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : '+ Tambah Otomasi'}
          </button>
        </div>
      </div>

      <div className="automation-list">
        {loading ? <div className="empty">Memuat otomasi...</div> : null}
        {!loading && automations.length === 0 ? <div className="empty">Belum ada otomasi.</div> : null}
        {automations.map((item) => (
          <div className="automation-row" key={item.id}>
            <div className="automation-info">
              <div className="automation-title">
                {item.name}
                <span className={`badge ${item.enabled ? 'completed' : 'failed'}`}>
                  {item.enabled ? 'aktif' : 'nonaktif'}
                </span>
                <span className="automation-schedule">{item.schedule}</span>
              </div>
              <div className="automation-meta">
                {branchFor(item)} · {item.agent} · berikutnya {formatDate(item.nextRunAt)}
              </div>
              <div className="automation-prompt">{item.prompt}</div>
            </div>
            <div className="automation-actions">
              <button className="btn tiny primary" onClick={() => void runNow(item)} disabled={runningId === item.id}>
                {runningId === item.id ? '...' : 'Run'}
              </button>
              <button className="btn tiny" onClick={() => void showRuns(item)}>
                {runsFor === item.id ? 'Tutup Riwayat' : 'Riwayat'}
              </button>
              <button className="btn tiny" onClick={() => void toggle(item)}>
                {item.enabled ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              <button className="btn tiny" onClick={() => edit(item)}>
                Edit
              </button>
              <button className="btn tiny ghost" onClick={() => void remove(item)}>
                Hapus
              </button>
            </div>
            {runsFor === item.id ? (
              <div className="automation-runs">
                {runs.length === 0 ? <span className="muted">Belum ada riwayat.</span> : null}
                {runs.map((run) => (
                  <div className="automation-run" key={run.id}>
                    <StatusBadge
                      status={
                        run.status === 'completed'
                          ? 'completed'
                          : run.status === 'failed'
                            ? 'failed'
                            : run.status === 'stopped'
                              ? 'stopped'
                              : 'running'
                      }
                    />
                    <span className="mono">{formatDate(run.startedAt)}</span>
                    {run.error ? <span className="automation-run-error">{run.error}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}
