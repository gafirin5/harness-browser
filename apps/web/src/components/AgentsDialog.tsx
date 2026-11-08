import { useCallback, useEffect, useState } from 'react';
import type { AgentInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';
import { Field, Modal, useToast } from './ui';

function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatArgs(args?: string[]): string {
  return (args ?? []).join('\n');
}

const SOURCE_LABEL: Record<string, string> = {
  builtin: 'Bawaan',
  env: 'Env',
  custom: 'Kustom'
};

interface ProfileInfo {
  id: string;
  name: string;
  agentId: string;
  isActive: boolean;
  envKeys: string[];
  rateLimitedUntil: string | null;
  updatedAt: string;
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return env;
}

export function AgentsDialog({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }): JSX.Element {
  const { push } = useToast();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [interactiveText, setInteractiveText] = useState('');

  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profileName, setProfileName] = useState('');
  const [profileAgent, setProfileAgent] = useState('');
  const [profileEnvText, setProfileEnvText] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await apiGet<{ data: AgentInfo[] }>('/agents');
      setAgents(response.data);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat daftar agent.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProfiles = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<{ data: ProfileInfo[] }>('/profiles');
      setProfiles(response.data);
    } catch {
      // abaikan bila gagal (mis. bukan admin)
    }
  }, []);

  useEffect(() => {
    void load();
    void loadProfiles();
  }, [load, loadProfiles]);

  const resetForm = (): void => {
    setEditingId(null);
    setId('');
    setName('');
    setCommand('');
    setArgsText('');
    setResumeText('');
    setInteractiveText('');
  };

  const fillForm = (agent: AgentInfo, editing: boolean): void => {
    setEditingId(editing ? agent.id : null);
    setId(agent.id);
    setName(agent.name);
    setCommand(agent.command);
    setArgsText(formatArgs(agent.args));
    setResumeText(formatArgs(agent.resumeArgs));
    setInteractiveText(formatArgs(agent.interactiveArgs));
  };

  const save = async (): Promise<void> => {
    if (!name.trim() || !command.trim()) {
      setError('Nama dan command wajib diisi.');
      return;
    }
    setPending(true);
    setError(null);
    const payload = {
      name: name.trim(),
      command: command.trim(),
      args: parseArgs(argsText),
      resumeArgs: parseArgs(resumeText),
      interactiveArgs: parseArgs(interactiveText)
    };
    try {
      if (editingId) {
        await apiPatch<{ data: AgentInfo }>(`/agents/${editingId}`, payload);
        push('success', 'Agent diperbarui.');
      } else {
        await apiPost<{ data: AgentInfo }>('/agents', { id: id.trim(), ...payload });
        push('success', 'Agent ditambahkan.');
      }
      resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan agent.');
    } finally {
      setPending(false);
    }
  };

  const remove = async (agent: AgentInfo): Promise<void> => {
    if (!window.confirm(`Hapus agent "${agent.name}"?`)) return;
    try {
      await apiDelete(`/agents/${agent.id}`);
      push('success', 'Agent dihapus.');
      if (editingId === agent.id) resetForm();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus agent.');
    }
  };

  const saveProfile = async (): Promise<void> => {
    if (!profileName.trim() || !profileAgent.trim()) {
      setError('Nama dan agent profil wajib diisi.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await apiPost('/profiles', {
        name: profileName.trim(),
        agentId: profileAgent.trim(),
        env: parseEnv(profileEnvText)
      });
      push('success', 'Profil disimpan.');
      setProfileName('');
      setProfileAgent('');
      setProfileEnvText('');
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan profil.');
    } finally {
      setPending(false);
    }
  };

  const activateProfile = async (profile: ProfileInfo): Promise<void> => {
    try {
      await apiPost(`/profiles/${profile.id}/activate`);
      push('success', `Profil ${profile.name} diaktifkan.`);
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengaktifkan profil.');
    }
  };

  const removeProfile = async (profile: ProfileInfo): Promise<void> => {
    if (!window.confirm(`Hapus profil "${profile.name}"?`)) return;
    try {
      await apiDelete(`/profiles/${profile.id}`);
      push('success', 'Profil dihapus.');
      await loadProfiles();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menghapus profil.');
    }
  };

  return (
    <Modal
      title="Kelola Agent"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Dorado mendukung banyak agent CLI. Preset bawaan siap dipakai; tambahkan agent kustom bila tool Anda belum ada.
        Agent dianggap terpasang bila command-nya ditemukan di host ini.
      </p>

      {error ? <div className="error-banner">{error}</div> : null}

      {isAdmin ? (
        <div className="orch-form">
          <div className="row" style={{ gap: 8 }}>
            <Field label="Id">
              <input
                className="input"
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="mis. claude"
                disabled={Boolean(editingId)}
              />
            </Field>
            <Field label="Nama">
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nama tampilan"
              />
            </Field>
          </div>
          <Field label="Command">
            <input
              className="input"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="mis. my-agent"
            />
          </Field>
          <Field label="Args (satu per baris)" hint="Gunakan {{prompt}} untuk instruksi.">
            <textarea
              className="textarea"
              rows={3}
              value={argsText}
              onChange={(event) => setArgsText(event.target.value)}
              placeholder={'mis.\n-p\n{{prompt}}'}
            />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <Field label="Resume args">
              <textarea
                className="textarea"
                rows={3}
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder={'-c\n-p\n{{prompt}}'}
              />
            </Field>
            <Field label="Interactive args" hint="Argumen saat dibuka tanpa prompt.">
              <textarea
                className="textarea"
                rows={3}
                value={interactiveText}
                onChange={(event) => setInteractiveText(event.target.value)}
                placeholder="(kosong)"
              />
            </Field>
          </div>
          <div className="orch-form-actions">
            {editingId ? (
              <button className="btn tiny" onClick={resetForm} disabled={pending}>
                Batal
              </button>
            ) : null}
            <button className="btn tiny primary" onClick={() => void save()} disabled={pending}>
              {pending ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : '+ Tambah Agent'}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 11.5 }}>
          Hanya admin yang dapat menambah atau mengubah agent.
        </p>
      )}

      <div className="section-label">Agent ({agents.length})</div>
      <div className="quick-command-list">
        {loading ? <div className="empty">Memuat agent...</div> : null}
        {!loading && agents.length === 0 ? <div className="empty">Belum ada agent.</div> : null}
        {agents.map((agent) => (
          <div className="quick-command-row" key={agent.id}>
            <div className="quick-command-info">
              <div className="quick-command-label">
                {agent.name}
                <span className="badge">{SOURCE_LABEL[agent.source ?? 'builtin'] ?? agent.source}</span>
                <span className={`badge ${agent.installed ? 'active' : 'inactive'}`}>
                  {agent.installed ? 'terpasang' : 'tidak ada'}
                </span>
              </div>
              <code className="quick-command-code">
                {agent.command} {agent.args.join(' ')}
              </code>
            </div>
            {isAdmin ? (
              <div className="quick-command-actions">
                {agent.source === 'custom' ? (
                  <>
                    <button className="btn tiny" onClick={() => fillForm(agent, true)}>
                      Edit
                    </button>
                    <button className="btn tiny ghost" onClick={() => void remove(agent)}>
                      Hapus
                    </button>
                  </>
                ) : (
                  <button
                    className="btn tiny"
                    onClick={() => fillForm(agent, false)}
                    title="Buat agent kustom dengan id sama untuk menimpa"
                  >
                    Override
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="section-label">Profil Agent (env / akun)</div>
      {isAdmin ? (
        <div className="orch-form">
          <div className="row" style={{ gap: 8 }}>
            <Field label="Nama profil">
              <input
                className="input"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Claude Pro A"
              />
            </Field>
            <Field label="Agent">
              <select className="select" value={profileAgent} onChange={(event) => setProfileAgent(event.target.value)}>
                <option value="">Pilih agent...</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Env (satu per baris, KEY=value)">
            <textarea
              className="textarea"
              rows={3}
              value={profileEnvText}
              onChange={(event) => setProfileEnvText(event.target.value)}
              placeholder={'ANTHROPIC_API_KEY=sk-...\nCLAUDE_CONFIG_DIR=/home/user/.claude-b'}
            />
          </Field>
          <div className="orch-form-actions">
            <button className="btn tiny primary" onClick={() => void saveProfile()} disabled={pending}>
              + Tambah Profil
            </button>
          </div>
        </div>
      ) : null}
      <div className="quick-command-list">
        {profiles.length === 0 ? <div className="empty">Belum ada profil.</div> : null}
        {profiles.map((profile) => (
          <div className="quick-command-row" key={profile.id}>
            <div className="quick-command-info">
              <div className="quick-command-label">
                {profile.name}
                <span className="badge">{profile.agentId}</span>
                {profile.isActive ? <span className="badge completed">aktif</span> : null}
                {profile.rateLimitedUntil ? <span className="badge failed">cooldown</span> : null}
              </div>
              <code className="quick-command-code">{profile.envKeys.join(', ') || '(tanpa env)'}</code>
            </div>
            {isAdmin ? (
              <div className="quick-command-actions">
                {!profile.isActive ? (
                  <button className="btn tiny" onClick={() => void activateProfile(profile)}>
                    Aktifkan
                  </button>
                ) : null}
                <button className="btn tiny ghost" onClick={() => void removeProfile(profile)}>
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
