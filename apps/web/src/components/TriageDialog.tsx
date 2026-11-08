import { useEffect, useState } from 'react';
import type { AgentInfo, Project, Worktree } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { Field, Modal, useToast } from './ui';

interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
}

interface FromIssueResult {
  worktreeId: string;
  sessionId: string;
  branch: string;
}

export function TriageDialog({
  projects,
  worktrees,
  selectedProjectId,
  selectedWorktreeId,
  agents,
  isAdmin,
  onClose
}: {
  projects: Project[];
  worktrees: Worktree[];
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
  agents: AgentInfo[];
  isAdmin: boolean;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const installed = agents.filter((agent) => agent.installed);
  const projectList = projects;
  const [projectId, setProjectId] = useState(selectedProjectId ?? projects[0]?.id ?? '');
  const projectWorktrees = worktrees.filter((worktree) => worktree.projectId === projectId);
  const [worktreeId, setWorktreeId] = useState(selectedWorktreeId ?? projectWorktrees[0]?.id ?? '');
  const [agent, setAgent] = useState(installed[0]?.id ?? '');
  const [checks, setChecks] = useState<CheckRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [source, setSource] = useState<'github' | 'linear'>('github');
  const [identifier, setIdentifier] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');

  const [linearConfigured, setLinearConfigured] = useState(false);
  const [linearKey, setLinearKey] = useState('');

  useEffect(() => {
    const exists = worktrees.some((worktree) => worktree.id === worktreeId && worktree.projectId === projectId);
    if (!exists) {
      setWorktreeId(worktrees.find((worktree) => worktree.projectId === projectId)?.id ?? '');
    }
  }, [projectId, worktrees, worktreeId]);

  useEffect(() => {
    apiGet<{ data: { configured: boolean } }>('/settings/linear')
      .then((response) => setLinearConfigured(response.data.configured))
      .catch(() => undefined);
  }, []);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Terjadi kesalahan.');
    } finally {
      setPending(false);
    }
  };

  const loadChecks = (): Promise<void> =>
    run(async () => {
      const response = await apiGet<{ data: { checks: CheckRun[] } }>(`/worktrees/${worktreeId}/checks`);
      setChecks(response.data.checks);
    });

  const fixCi = (): Promise<void> =>
    run(async () => {
      const response = await apiPost<{ data: { failures: number } }>(`/worktrees/${worktreeId}/fix-ci`, {
        agentId: agent
      });
      push('success', `Sesi perbaikan CI dibuat (${response.data.failures} kegagalan).`);
    });

  const createFromIssue = (): Promise<void> =>
    run(async () => {
      if (!identifier.trim()) {
        throw new ApiError(422, 'VALIDATION', 'Identifier issue wajib diisi.', { identifier: 'Wajib diisi.' });
      }
      const response = await apiPost<{ data: FromIssueResult }>(`/projects/${projectId}/from-issue`, {
        source,
        identifier: identifier.trim(),
        agentId: agent,
        ...(issueTitle.trim() ? { title: issueTitle.trim() } : {}),
        ...(issueBody.trim() ? { body: issueBody.trim() } : {})
      });
      push('success', `Worktree ${response.data.branch} dibuat.`);
      setIdentifier('');
      setIssueTitle('');
      setIssueBody('');
    });

  const saveLinear = (): Promise<void> =>
    run(async () => {
      if (linearKey.trim().length < 8) {
        throw new ApiError(422, 'VALIDATION', 'API key minimal 8 karakter.', { apiKey: 'Terlalu pendek.' });
      }
      const response = await apiPut<{ data: { configured: boolean } }>('/settings/linear', {
        apiKey: linearKey.trim()
      });
      setLinearConfigured(response.data.configured);
      setLinearKey('');
      push('success', 'LINEAR_API_KEY disimpan.');
    });

  const clearLinear = (): Promise<void> =>
    run(async () => {
      await apiDelete('/settings/linear');
      setLinearConfigured(false);
      push('success', 'LINEAR_API_KEY dihapus.');
    });

  return (
    <Modal
      title="Triage CI & Issue"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="row" style={{ gap: 8 }}>
        <Field label="Project">
          <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projectList.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Worktree">
          <select className="select" value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>
            {projectWorktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Agent">
          <select className="select" value={agent} onChange={(event) => setAgent(event.target.value)}>
            {installed.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="section-label">CI (GitHub Actions)</div>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <button className="btn tiny" onClick={() => void loadChecks()} disabled={pending || !worktreeId}>
          Periksa CI
        </button>
        <button className="btn tiny primary" onClick={() => void fixCi()} disabled={pending || !worktreeId}>
          Perbaiki CI
        </button>
      </div>
      {checks ? (
        <div className="quick-command-list">
          {checks.length === 0 ? <div className="empty">Tidak ada check run.</div> : null}
          {checks.map((check) => (
            <div className="quick-command-row" key={check.name}>
              <div className="quick-command-info">
                <div className="quick-command-label">
                  {check.name}
                  <span className={`badge ${check.conclusion === 'success' ? 'completed' : 'failed'}`}>
                    {check.conclusion ?? check.status}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="section-label">Issue → Worktree</div>
      <div className="row" style={{ gap: 8 }}>
        <Field label="Sumber">
          <select
            className="select"
            value={source}
            onChange={(event) => setSource(event.target.value as 'github' | 'linear')}
          >
            <option value="github">GitHub</option>
            <option value="linear">Linear</option>
          </select>
        </Field>
        <Field label="Identifier" hint={source === 'github' ? 'mis. 42 atau #42' : 'mis. ENG-108'}>
          <input className="input" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        </Field>
      </div>
      <Field label="Judul (opsional)" hint="Kosongkan untuk mengambil dari API">
        <input className="input" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
      </Field>
      <Field label="Deskripsi (opsional)">
        <textarea
          className="textarea"
          rows={3}
          value={issueBody}
          onChange={(event) => setIssueBody(event.target.value)}
        />
      </Field>
      <div className="orch-form-actions">
        <button className="btn tiny primary" onClick={() => void createFromIssue()} disabled={pending || !projectId}>
          {pending ? 'Memproses...' : 'Buat Worktree'}
        </button>
      </div>

      {isAdmin ? (
        <>
          <div className="section-label">Linear API Key {linearConfigured ? '(terpasang)' : '(belum diatur)'}</div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              type="password"
              value={linearKey}
              onChange={(event) => setLinearKey(event.target.value)}
              placeholder="lin_api_..."
            />
            <button className="btn tiny" onClick={() => void saveLinear()} disabled={pending}>
              Simpan
            </button>
            {linearConfigured ? (
              <button className="btn tiny ghost" onClick={() => void clearLinear()} disabled={pending}>
                Hapus
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
