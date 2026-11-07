import { useEffect, useState } from 'react';
import type { AgentInfo, PairingTokenInfo, Project, SessionInfo, Worktree } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost, copyText } from '../lib/api';
import { Field, Modal, StatusBadge, useToast } from './ui';

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

interface DiscoveredRepo {
  path: string;
  name: string;
  branch: string | null;
}

export function AddProjectDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [repos, setRepos] = useState<DiscoveredRepo[]>([]);
  const [query, setQuery] = useState('');
  const [discovered, setDiscovered] = useState(false);

  const discover = async (): Promise<void> => {
    setDiscovering(true);
    setError(null);
    try {
      const response = await apiGet<{ data: DiscoveredRepo[]; meta: { total: number; truncated: boolean } }>(
        '/projects/discover'
      );
      setRepos(response.data);
      setDiscovered(true);
    } catch (caught) {
      setError(errorText(caught, 'Gagal memindai repository.'));
    } finally {
      setDiscovering(false);
    }
  };

  const filterRepos = (): DiscoveredRepo[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) return repos;
    return repos.filter((repo) => repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle));
  };

  const pickRepo = (repo: DiscoveredRepo): void => {
    setRepoPath(repo.path);
    if (!name.trim()) setName(repo.name);
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFields({});
    setPending(true);
    try {
      const response = await apiPost<{ data: Project }>('/projects', { name, path: repoPath });
      onCreated(response.data);
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Gagal menambah project.'));
      if (caught instanceof ApiError) setFields(caught.fields ?? {});
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title="Tambah Project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>
            Batal
          </button>
          <button className="btn primary" type="submit" form="project-form" disabled={pending}>
            {pending ? 'Menambahkan...' : 'Tambah Project'}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={(event) => void submit(event)}>
        {error ? <div className="error-banner">{error}</div> : null}
        <Field label="Nama project" error={fields.name}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Path repository" error={fields.path} hint="Path absolut ke root repository Git di host ini.">
          <input
            className="input"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/home/user/projects/app"
            list="discovered-repos"
            required
          />
          <datalist id="discovered-repos">
            {filterRepos().map((repo) => (
              <option key={repo.path} value={repo.path}>
                {repo.name}
              </option>
            ))}
          </datalist>
        </Field>

        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <button className="btn tiny" type="button" onClick={() => void discover()} disabled={discovering}>
            {discovering ? 'Memindai...' : '🔍 Pindai Repository'}
          </button>
          {discovered ? (
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter nama/path..."
              aria-label="Filter repository"
            />
          ) : null}
        </div>

        {discovered && !discovering ? (
          <div className="discover-list">
            {filterRepos().length === 0 ? (
              <div className="empty">Tidak ada repository yang cocok.</div>
            ) : (
              filterRepos()
                .slice(0, 50)
                .map((repo) => (
                  <button
                    key={repo.path}
                    type="button"
                    className={`discover-item ${repoPath === repo.path ? 'active' : ''}`}
                    onClick={() => pickRepo(repo)}
                  >
                    <span className="discover-name">{repo.name}</span>
                    {repo.branch ? <span className="badge running mono">{repo.branch}</span> : null}
                    <span className="discover-path mono">{repo.path}</span>
                  </button>
                ))
            )}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

export function NewWorktreeDialog({
  project,
  onClose,
  onCreated
}: {
  project: Project;
  onClose: () => void;
  onCreated: (worktree: Worktree) => void;
}): JSX.Element {
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState('');
  const [baseRef, setBaseRef] = useState('HEAD');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    apiGet<{ data: string[] }>(`/projects/${project.id}/branches`)
      .then((response) => {
        setBranches(response.data);
        if (response.data.length > 0) setBaseRef(response.data[0] ?? 'HEAD');
      })
      .catch(() => setBranches([]));
  }, [project.id]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await apiPost<{ data: Worktree }>('/worktrees', {
        projectId: project.id,
        branch,
        baseRef
      });
      onCreated(response.data);
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Gagal membuat worktree.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`Worktree Baru — ${project.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>
            Batal
          </button>
          <button className="btn primary" type="submit" form="worktree-form" disabled={pending}>
            {pending ? 'Membuat...' : 'Buat Worktree'}
          </button>
        </>
      }
    >
      <form id="worktree-form" onSubmit={(event) => void submit(event)}>
        {error ? <div className="error-banner">{error}</div> : null}
        <Field label="Nama branch" hint="Branch baru akan dibuat bila belum ada.">
          <input
            className="input mono"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="agent/task-01"
            required
          />
        </Field>
        <Field label="Base ref">
          <select className="select mono" value={baseRef} onChange={(event) => setBaseRef(event.target.value)}>
            {branches.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            <option value="HEAD">HEAD</option>
          </select>
        </Field>
        <div className="hint">
          Worktree dibuat di <span className="mono">{project.path}</span> dan disimpan di data directory Dorado.
        </div>
      </form>
    </Modal>
  );
}

export function NewSessionDialog({
  worktree,
  agents,
  onClose,
  onCreated
}: {
  worktree: Worktree;
  agents: AgentInfo[];
  onClose: () => void;
  onCreated: (session: SessionInfo) => void;
}): JSX.Element {
  const installed = agents.filter((agent) => agent.installed);
  const [agent, setAgent] = useState(installed[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await apiPost<{ data: SessionInfo }>('/sessions', {
        worktreeId: worktree.id,
        agent,
        title
      });
      onCreated(response.data);
      onClose();
    } catch (caught) {
      setError(errorText(caught, 'Gagal memulai agent.'));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      title={`Agent Baru — ${worktree.branch}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={pending}>
            Batal
          </button>
          <button
            className="btn primary"
            type="submit"
            form="session-form"
            disabled={pending || installed.length === 0}
            title="Ctrl+Enter"
          >
            {pending ? 'Menjalankan...' : 'Jalankan Agent'}
          </button>
        </>
      }
    >
      <form id="session-form" onSubmit={(event) => void submit(event)}>
        {error ? <div className="error-banner">{error}</div> : null}
        {installed.length === 0 ? (
          <div className="error-banner">Belum ada agent CLI yang terpasang di host ini.</div>
        ) : null}
        <Field label="Agent">
          <select className="select" value={agent} onChange={(event) => setAgent(event.target.value)}>
            {agents.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.installed}>
                {item.name} {item.installed ? '' : '(belum terpasang)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Judul sesi">
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </Field>
        <p className="hint" style={{ marginTop: 0 }}>
          Agent akan dibuka secara interaktif. Ketik instruksi langsung di terminal agent.
        </p>
      </form>
    </Modal>
  );
}

export function ShareDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { push } = useToast();
  const [tokens, setTokens] = useState<PairingTokenInfo[]>([]);
  const [created, setCreated] = useState<{ token: string; pairUrl: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    apiGet<{ data: PairingTokenInfo[] }>('/pairing')
      .then((response) => setTokens(response.data))
      .catch((caught: unknown) => setError(errorText(caught, 'Gagal memuat token.')));
  };

  useEffect(load, []);

  const create = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: { token: string; pairUrl: string } }>('/pairing', { label: 'Browser' });
      setCreated(response.data);
      load();
    } catch (caught) {
      setError(errorText(caught, 'Gagal membuat token.'));
    } finally {
      setPending(false);
    }
  };

  const revoke = async (id: string): Promise<void> => {
    try {
      await apiDelete(`/pairing/${id}`);
      load();
    } catch (caught) {
      push('error', errorText(caught, 'Gagal mencabut token.'));
    }
  };

  return (
    <Modal
      title="Share & Pairing"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Selesai
        </button>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}
      <p className="hint" style={{ marginTop: 0 }}>
        Pairing token memberi akses penuh ke runtime. Gunakan hanya untuk browser yang Anda percaya dan cabut bila tidak
        dipakai.
      </p>
      <button className="btn primary" onClick={() => void create()} disabled={pending}>
        {pending ? 'Membuat...' : 'Buat Pairing Token'}
      </button>

      {created ? (
        <div style={{ marginTop: 14 }}>
          <div className="section-label">Pairing URL baru (tampil sekali)</div>
          <div className="pair-box">
            <input className="input" readOnly value={created.pairUrl} />
            <button
              className="btn"
              onClick={() => {
                void copyText(created.pairUrl).then((ok) =>
                  push(ok ? 'success' : 'error', ok ? 'Pairing URL disalin.' : 'Gagal menyalin.')
                );
              }}
            >
              Salin
            </button>
          </div>
          <div className="hint">
            Token: <span className="mono">{created.token}</span>
          </div>
        </div>
      ) : null}

      <div className="section-label">Token aktif</div>
      {tokens.length === 0 ? (
        <div className="empty">Belum ada token pairing.</div>
      ) : (
        tokens.map((token) => (
          <div key={token.id} className="kv">
            <span className="k">
              {token.label}
              <br />
              <span className="mono" style={{ fontSize: 10 }}>
                exp {new Date(token.expiresAt).toLocaleDateString('id-ID')}
              </span>
            </span>
            <span className="v">
              {token.revokedAt ? (
                <StatusBadge status="stopped" />
              ) : (
                <button className="btn tiny danger" onClick={() => void revoke(token.id)}>
                  Cabut
                </button>
              )}
            </span>
          </div>
        ))
      )}
    </Modal>
  );
}
