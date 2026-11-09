import { useCallback, useEffect, useState } from 'react';
import type { Project, SshTunnelInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost } from '../lib/api';
import { Field, Modal, useToast } from './ui';

interface FormState {
  projectId: string;
  name: string;
  host: string;
  port: string;
  user: string;
  localPort: string;
  remotePort: string;
}

const EMPTY_FORM: FormState = {
  projectId: '',
  name: '',
  host: '',
  port: '22',
  user: '',
  localPort: '',
  remotePort: ''
};

export function SshTunnelsDialog({
  projects,
  isAdmin,
  onClose
}: {
  projects: Project[];
  isAdmin: boolean;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [tunnels, setTunnels] = useState<SshTunnelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, projectId: projects[0]?.id ?? '' });
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<{ data: SshTunnelInfo[] }>('/ssh-tunnels');
      setTunnels(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat daftar tunnel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const projectId = form.projectId.trim();
    const host = form.host.trim();
    const user = form.user.trim();
    if (!projectId || !host || !user) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: SshTunnelInfo }>('/ssh-tunnels', {
        projectId,
        name: form.name.trim() || `${user}@${host}`,
        host,
        port: Number(form.port) || 22,
        user,
        localPort: Number(form.localPort),
        remotePort: Number(form.remotePort)
      });
      push('success', `Tunnel "${response.data.name}" dibuat (localhost:${response.data.localPort}).`);
      setForm((current) => ({ ...EMPTY_FORM, projectId: current.projectId }));
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal membuat tunnel.');
    } finally {
      setPending(false);
    }
  };

  const action = async (tunnel: SshTunnelInfo, verb: 'start' | 'stop' | 'restart'): Promise<void> => {
    try {
      await apiPost(`/ssh-tunnels/${tunnel.id}/${verb}`);
      await load();
      push('success', `Tunnel "${tunnel.name}" di-${verb}.`);
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : `Gagal ${verb} tunnel.`);
    }
  };

  const remove = async (tunnel: SshTunnelInfo): Promise<void> => {
    if (!window.confirm(`Hapus tunnel "${tunnel.name}"? Forwarding akan dihentikan.`)) return;
    try {
      await apiDelete(`/ssh-tunnels/${tunnel.id}`);
      await load();
      push('success', `Tunnel "${tunnel.name}" dihapus.`);
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal menghapus tunnel.');
    }
  };

  const projectName = (projectId: string): string =>
    projects.find((project) => project.id === projectId)?.name ?? projectId;

  return (
    <Modal
      title="SSH Tunnel (Port Forwarding)"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Forward port remote dari server melalui SSH ke <span className="mono">127.0.0.1</span> lokal. Port lokal akan
        otomatis muncul di daftar port Live Preview.
      </p>

      {error ? <div className="error-banner">{error}</div> : null}

      {isAdmin && projects.length > 0 ? (
        <form className="node-create-form" onSubmit={(event) => void create(event)}>
          <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Project">
              <select
                className="select"
                value={form.projectId}
                onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nama (opsional)">
              <input
                className="input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Dev server"
                maxLength={80}
              />
            </Field>
            <Field label="User SSH">
              <input
                className="input"
                value={form.user}
                onChange={(event) => setForm((current) => ({ ...current, user: event.target.value }))}
                placeholder="deploy"
                required
              />
            </Field>
            <Field label="Host SSH">
              <input
                className="input"
                value={form.host}
                onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                placeholder="vps.example.com"
                required
              />
            </Field>
            <Field label="Port SSH">
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => setForm((current) => ({ ...current, port: event.target.value }))}
              />
            </Field>
            <Field label="Port lokal">
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={form.localPort}
                onChange={(event) => setForm((current) => ({ ...current, localPort: event.target.value }))}
                placeholder="13000"
                required
              />
            </Field>
            <Field label="Port remote">
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={form.remotePort}
                onChange={(event) => setForm((current) => ({ ...current, remotePort: event.target.value }))}
                placeholder="3000"
                required
              />
            </Field>
            <button className="btn primary" type="submit" disabled={pending}>
              {pending ? 'Membuat...' : '+ Buat Tunnel'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="node-list">
        {loading ? <div className="empty">Memuat daftar tunnel...</div> : null}
        {!loading && tunnels.length === 0 ? (
          <div className="empty">
            {isAdmin
              ? 'Belum ada tunnel. Tambahkan satu di atas untuk mem-forward port remote.'
              : 'Belum ada tunnel SSH.'}
          </div>
        ) : null}

        {tunnels.map((tunnel) => (
          <div key={tunnel.id} className="node-card">
            <div className="node-card-main">
              <div className="node-card-title">
                <span>🔌 {tunnel.name}</span>
                <span className={`badge ${tunnel.status === 'running' ? 'running' : 'stopped'}`}>{tunnel.status}</span>
              </div>
              <div className="node-card-meta">
                <span className="mono">
                  {tunnel.user}@{tunnel.host}:{tunnel.port}
                </span>
                <span>
                  {' '}
                  → localhost:{tunnel.localPort} → remote {tunnel.remotePort}
                </span>
                <span> · {projectName(tunnel.projectId)}</span>
              </div>
            </div>
            {isAdmin ? (
              <div className="node-card-actions">
                {tunnel.status === 'running' ? (
                  <button className="btn tiny" onClick={() => void action(tunnel, 'stop')}>
                    Stop
                  </button>
                ) : (
                  <button className="btn tiny" onClick={() => void action(tunnel, 'start')}>
                    Start
                  </button>
                )}
                <button className="btn tiny" onClick={() => void action(tunnel, 'restart')}>
                  Restart
                </button>
                <button className="btn tiny ghost danger" onClick={() => void remove(tunnel)} title="Hapus tunnel">
                  Hapus
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export default SshTunnelsDialog;
