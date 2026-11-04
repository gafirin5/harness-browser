import { useCallback, useEffect, useState } from 'react';
import type { Project, QuickCommand, TerminalInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, copyText } from '../lib/api';
import { Modal, useToast } from './ui';

export function QuickCommandsDialog({
  project,
  activeTerminal,
  onClose
}: {
  project: Project | null;
  activeTerminal: TerminalInfo | null;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [commands, setCommands] = useState<QuickCommand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>(project ? 'project' : 'global');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = project ? `?projectId=${encodeURIComponent(project.id)}` : '';
      const response = await apiGet<{ data: QuickCommand[] }>(`/quick-commands${query}`);
      setCommands(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat quick commands.');
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = (): void => {
    setLabel('');
    setCommand('');
    setEditingId(null);
    setScope(project ? 'project' : 'global');
  };

  const save = async (): Promise<void> => {
    if (!label.trim() || !command.trim()) {
      setError('Label dan command wajib diisi.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const payload = {
        label: label.trim(),
        command,
        scope,
        projectId: scope === 'project' ? (project?.id ?? null) : null
      };
      if (editingId) {
        await apiPatch<{ data: QuickCommand }>(`/quick-commands/${editingId}`, payload);
        push('success', 'Quick command diperbarui.');
      } else {
        await apiPost<{ data: QuickCommand }>('/quick-commands', payload);
        push('success', 'Quick command ditambahkan.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan quick command.');
    } finally {
      setPending(false);
    }
  };

  const remove = async (item: QuickCommand): Promise<void> => {
    if (!window.confirm(`Hapus quick command "${item.label}"?`)) return;
    try {
      await apiDelete(`/quick-commands/${item.id}`);
      push('success', 'Quick command dihapus.');
      if (editingId === item.id) resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus quick command.');
    }
  };

  const run = async (item: QuickCommand): Promise<void> => {
    if (!activeTerminal || activeTerminal.status !== 'running') {
      setError('Buka terminal yang sedang berjalan terlebih dahulu.');
      return;
    }
    setRunningId(item.id);
    setError(null);
    try {
      await apiPost(`/terminals/${activeTerminal.id}/input`, { data: `${item.command}\r` });
      push('success', `Menjalankan "${item.label}" di ${activeTerminal.title}.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menjalankan command.');
    } finally {
      setRunningId(null);
    }
  };

  const copy = async (item: QuickCommand): Promise<void> => {
    const ok = await copyText(item.command);
    push(ok ? 'success' : 'error', ok ? 'Command disalin.' : 'Gagal menyalin command.');
  };

  return (
    <Modal
      title="Quick Commands"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Simpan perintah yang sering dipakai, lalu jalankan di terminal aktif
        {project ? ` project ${project.name}` : ''}. Command global tersedia di semua project.
      </p>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="quick-command-form">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            placeholder="Label, mis. Test cepat"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
          />
          <select
            className="input"
            value={scope}
            onChange={(event) => setScope(event.target.value as 'global' | 'project')}
            aria-label="Scope quick command"
            disabled={!project}
          >
            <option value="project">Project ini</option>
            <option value="global">Global</option>
          </select>
        </div>
        <textarea
          className="textarea"
          rows={2}
          placeholder="Command, mis. npm run test"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          maxLength={4000}
        />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          {editingId ? (
            <button className="btn tiny" onClick={resetForm} disabled={pending}>
              Batal Edit
            </button>
          ) : null}
          <button className="btn tiny primary" onClick={() => void save()} disabled={pending}>
            {pending ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : '+ Tambah Command'}
          </button>
        </div>
      </div>

      <div className="quick-command-list">
        {loading ? <div className="empty">Memuat command...</div> : null}
        {!loading && commands.length === 0 ? <div className="empty">Belum ada quick command.</div> : null}
        {commands.map((item) => (
          <div className="quick-command-row" key={item.id}>
            <div className="quick-command-info">
              <div className="quick-command-label">
                {item.label}
                <span className={`badge ${item.scope === 'global' ? 'completed' : ''}`}>
                  {item.scope === 'global' ? 'global' : 'project'}
                </span>
              </div>
              <code className="quick-command-code">{item.command}</code>
            </div>
            <div className="quick-command-actions">
              <button
                className="btn tiny primary"
                onClick={() => void run(item)}
                disabled={runningId === item.id || !activeTerminal || activeTerminal.status !== 'running'}
                title={activeTerminal ? `Jalankan di ${activeTerminal.title}` : 'Tidak ada terminal aktif'}
              >
                {runningId === item.id ? '...' : 'Run'}
              </button>
              <button className="btn tiny" onClick={() => void copy(item)}>
                Copy
              </button>
              <button
                className="btn tiny"
                onClick={() => {
                  setEditingId(item.id);
                  setLabel(item.label);
                  setCommand(item.command);
                  setScope(item.scope);
                }}
              >
                Edit
              </button>
              <button className="btn tiny ghost" onClick={() => void remove(item)}>
                Hapus
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
