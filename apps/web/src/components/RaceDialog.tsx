import { useEffect, useState } from 'react';
import type { AgentInfo, Project, Race } from '@dorado/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Field, Modal, useToast } from './ui';

const STATUS_LABEL: Record<string, string> = {
  running: 'Berjalan',
  won: 'Pemenang',
  lost: 'Kalah'
};

export function RaceDialog({
  projects,
  agents,
  onClose
}: {
  projects: Project[];
  agents: AgentInfo[];
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const installed = agents.filter((agent) => agent.installed);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [selected, setSelected] = useState<string[]>(installed.slice(0, 2).map((agent) => agent.id));
  const [race, setRace] = useState<Race | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const toggleAgent = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= 4 ? current : [...current, id]
    );
  };

  useEffect(() => {
    if (!race || race.status !== 'running') return undefined;
    const timer = window.setInterval(() => {
      apiGet<{ data: Race }>(`/races/${race.id}`)
        .then((response) => setRace(response.data))
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [race]);

  const start = async (): Promise<void> => {
    if (!projectId) {
      setError('Pilih project terlebih dahulu.');
      return;
    }
    if (selected.length < 2) {
      setError('Pilih minimal 2 agent.');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt wajib diisi.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: Race }>(`/projects/${projectId}/races`, {
        prompt: prompt.trim(),
        agentIds: selected,
        ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {})
      });
      setRace(response.data);
      push('success', 'Race dimulai.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memulai race.');
    } finally {
      setPending(false);
    }
  };

  const applyWinner = async (worktreeId: string): Promise<void> => {
    if (!race) return;
    if (!window.confirm('Terapkan worktree ini sebagai pemenang dan merge ke base branch?')) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: Race }>(`/races/${race.id}/apply-winner`, {
        worktreeId,
        cleanupLosers: true
      });
      setRace(response.data);
      push('success', 'Pemenang diterapkan.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menerapkan pemenang.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="Worktree Racing"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}

      {!race ? (
        <div className="orch-form">
          <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
            Jalankan prompt yang sama di 2–4 agent pada worktree terisolasi, lalu pilih yang terbaik untuk di-merge.
          </p>
          <div className="row" style={{ gap: 8 }}>
            <Field label="Project">
              <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Base branch" hint="Kosongkan untuk branch aktif">
              <input
                className="input"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                placeholder="main"
              />
            </Field>
          </div>
          <Field label="Prompt">
            <textarea
              className="textarea"
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="mis. Perbaiki race condition pada modul auth"
            />
          </Field>
          <Field label={`Agent (${selected.length}/4)`}>
            <div className="race-agents">
              {installed.length === 0 ? (
                <div className="error-banner">Belum ada agent CLI yang terpasang.</div>
              ) : (
                installed.map((agent) => (
                  <label key={agent.id} className="race-agent">
                    <input
                      type="checkbox"
                      checked={selected.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                    />
                    <span>{agent.name}</span>
                  </label>
                ))
              )}
            </div>
          </Field>
          <div className="orch-form-actions">
            <button className="btn tiny primary" onClick={() => void start()} disabled={pending}>
              {pending ? 'Memulai...' : 'Mulai Race'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
            Base: <span className="mono">{race.baseBranch}</span> · status:{' '}
            {race.status === 'running' ? 'berjalan' : 'selesai'}
          </p>
          <div className="quick-command-list">
            {race.entries.map((entry) => (
              <div className="quick-command-row" key={entry.id}>
                <div className="quick-command-info">
                  <div className="quick-command-label">
                    {entry.agentId}
                    <span className={`badge ${entry.status === 'won' ? 'completed' : ''}`}>
                      {STATUS_LABEL[entry.status] ?? entry.status}
                    </span>
                    <span className="badge">{entry.sessionStatus}</span>
                  </div>
                  <code className="quick-command-code">
                    +{entry.insertions} / -{entry.deletions} · {entry.filesChanged} file · {entry.branch}
                  </code>
                </div>
                <div className="quick-command-actions">
                  <button
                    className="btn tiny primary"
                    onClick={() => void applyWinner(entry.worktreeId)}
                    disabled={pending || race.status !== 'running' || entry.status === 'lost'}
                  >
                    Pilih & Merge
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
