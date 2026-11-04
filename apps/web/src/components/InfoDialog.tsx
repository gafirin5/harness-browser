import { useEffect, useState } from 'react';
import type { AgentInfo } from '@dorado/shared';
import { ApiError, apiGet, copyText } from '../lib/api';
import { Modal, StatusBadge, useToast } from './ui';

export interface Info {
  version: string;
  node: string;
  uptimeSeconds: number;
  dataDir: string;
  timezone: string;
  tmux: string | null;
  agents: AgentInfo[];
  counts: {
    projects: number;
    worktrees: number;
    terminals: number;
    sessions: number;
    providers: number;
    agents: number;
    tasks: number;
  };
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours} jam ${minutes} menit` : `${minutes} menit`;
}

export function buildRuntimeSummary(info: Info): string {
  const agentLines =
    info.agents.length > 0
      ? info.agents.map(
          (agent) => `- ${agent.name} (${agent.command}): ${agent.installed ? 'terpasang' : 'tidak ada'}`
        )
      : ['- Tidak ada agent.'];
  return [
    'Info Runtime Dorado',
    `Versi: ${info.version}`,
    `Node.js: ${info.node}`,
    `Uptime: ${formatUptime(info.uptimeSeconds)}`,
    `Timezone: ${info.timezone}`,
    `tmux: ${info.tmux ?? 'tidak tersedia'}`,
    `Data dir: ${info.dataDir}`,
    'Counts:',
    `- Projects: ${info.counts.projects}`,
    `- Worktrees: ${info.counts.worktrees}`,
    `- Terminals: ${info.counts.terminals}`,
    `- Sessions: ${info.counts.sessions}`,
    `- Providers: ${info.counts.providers}`,
    `- Agents: ${info.counts.agents}`,
    `- Tasks: ${info.counts.tasks}`,
    'Agents:',
    ...agentLines
  ].join('\n');
}

export function InfoDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  useEffect(() => {
    apiGet<{ data: Info }>('/info')
      .then((response) => setInfo(response.data))
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : 'Gagal memuat info runtime.'));
  }, []);

  const copySummary = (): void => {
    if (!info) return;
    void copyText(buildRuntimeSummary(info)).then((ok) =>
      push(ok ? 'success' : 'error', ok ? 'Ringkasan runtime disalin.' : 'Gagal menyalin ringkasan runtime.')
    );
  };

  return (
    <Modal
      title="Info Runtime"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={copySummary} disabled={!info}>
            Salin Ringkasan
          </button>
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
        </>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}
      {!info && !error ? <div className="empty">Memuat info runtime...</div> : null}
      {info ? (
        <>
          <div className="kv">
            <span className="k">Versi Dorado</span>
            <span className="v">{info.version}</span>
          </div>
          <div className="kv">
            <span className="k">Node.js</span>
            <span className="v">{info.node}</span>
          </div>
          <div className="kv">
            <span className="k">Uptime</span>
            <span className="v">{formatUptime(info.uptimeSeconds)}</span>
          </div>
          <div className="kv">
            <span className="k">Timezone</span>
            <span className="v">{info.timezone}</span>
          </div>
          <div className="kv">
            <span className="k">Terminal host</span>
            <span className="v">{info.tmux ?? 'tmux tidak tersedia'}</span>
          </div>
          <div className="kv">
            <span className="k">Data directory</span>
            <span className="v">{info.dataDir}</span>
          </div>
          <div className="section-label">Data</div>
          <div className="kv">
            <span className="k">Projects / Worktrees</span>
            <span className="v">
              {info.counts.projects} / {info.counts.worktrees}
            </span>
          </div>
          <div className="kv">
            <span className="k">Terminals / Sessions</span>
            <span className="v">
              {info.counts.terminals} / {info.counts.sessions}
            </span>
          </div>
          <div className="kv">
            <span className="k">Providers / Agents / Tasks</span>
            <span className="v">
              {info.counts.providers} / {info.counts.agents} / {info.counts.tasks}
            </span>
          </div>
          <div className="section-label">Agent CLI</div>
          {info.agents.map((agent) => (
            <div className="kv" key={agent.id}>
              <span className="k">
                {agent.name} <span className="mono">({agent.command})</span>
              </span>
              <span className="v">
                <StatusBadge status={agent.installed ? 'completed' : 'failed'} />
                {agent.installed ? ' terpasang' : ' tidak ada'}
              </span>
            </div>
          ))}
        </>
      ) : null}
    </Modal>
  );
}
