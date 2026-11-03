import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentInfo,
  PairingTokenInfo,
  Project,
  SessionInfo,
  TerminalInfo,
  UserInfo,
  Worktree
} from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost } from './lib/api';
import { Login } from './components/Login';
import { TerminalPane } from './components/TerminalPane';
import {
  AddProjectDialog,
  NewSessionDialog,
  NewWorktreeDialog,
  ShareDialog
} from './components/Dialogs';
import { Spinner, StatusBadge, useToast } from './components/ui';

type DialogState =
  | { type: 'project' }
  | { type: 'worktree'; project: Project }
  | { type: 'session'; worktree: Worktree }
  | { type: 'share' }
  | null;

export function App(): JSX.Element {
  const { push } = useToast();
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const mutationAt = useRef(0);
  const dataVersion = useRef(0);
  const markMutation = (): void => {
    mutationAt.current = Date.now();
    dataVersion.current += 1;
  };

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? null;

  const toastError = useCallback(
    (caught: unknown, fallback: string) => {
      push('error', caught instanceof ApiError ? caught.message : fallback);
    },
    [push]
  );

  const loadProjects = useCallback(async () => {
    const response = await apiGet<{ data: Project[] }>('/projects');
    setProjects(response.data);
    return response.data;
  }, []);

  const loadAgents = useCallback(async () => {
    const response = await apiGet<{ data: AgentInfo[] }>('/agents');
    setAgents(response.data);
  }, []);

  useEffect(() => {
    apiGet<{ data: { user: UserInfo } }>('/auth/me')
      .then((response) => setUser(response.data.user))
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadProjects().catch((caught: unknown) => toastError(caught, 'Gagal memuat project.'));
    void loadAgents().catch((caught: unknown) => toastError(caught, 'Gagal memuat agent.'));
  }, [user, loadProjects, loadAgents, toastError]);

  const selectProject = useCallback(async (project: Project) => {
    dataVersion.current += 1;
    setSelectedProjectId(project.id);
    setSelectedWorktreeId(null);
    setWorktrees([]);
    setTerminals([]);
    setSessions([]);
    setActiveTerminalId(null);
    try {
      const response = await apiGet<{ data: Worktree[] }>(`/worktrees?projectId=${encodeURIComponent(project.id)}`);
      setWorktrees(response.data);
    } catch (caught) {
      toastError(caught, 'Gagal memuat worktree.');
    }
  }, [toastError]);

  const loadWorktreeData = useCallback(
    async (worktreeId: string, silent = false) => {
      if (silent && Date.now() - mutationAt.current < 2600) return;
      const version = dataVersion.current;
      try {
        const [terminalResponse, sessionResponse] = await Promise.all([
          apiGet<{ data: TerminalInfo[] }>(`/terminals?worktreeId=${encodeURIComponent(worktreeId)}`),
          apiGet<{ data: SessionInfo[] }>(`/sessions?worktreeId=${encodeURIComponent(worktreeId)}`)
        ]);
        if (version !== dataVersion.current) return;
        setTerminals(terminalResponse.data);
        setSessions(sessionResponse.data);
        setActiveTerminalId((current) => {
          if (current && terminalResponse.data.some((terminal) => terminal.id === current)) return current;
          return terminalResponse.data[0]?.id ?? null;
        });
      } catch (caught) {
        if (!silent) toastError(caught, 'Gagal memuat terminal/sesi.');
      }
    },
    [toastError]
  );

  const selectWorktree = useCallback(
    async (worktree: Worktree) => {
      dataVersion.current += 1;
      setSelectedWorktreeId(worktree.id);
      setTerminals([]);
      setSessions([]);
      setActiveTerminalId(null);
      await loadWorktreeData(worktree.id);
    },
    [loadWorktreeData]
  );

  useEffect(() => {
    if (!user || projects.length === 0 || selectedProjectId) return;
    void selectProject(projects[0]!);
  }, [user, projects, selectedProjectId, selectProject]);

  useEffect(() => {
    if (!selectedProjectId || worktrees.length === 0 || selectedWorktreeId) return;
    void selectWorktree(worktrees[0]!);
  }, [selectedProjectId, worktrees, selectedWorktreeId, selectWorktree]);

  useEffect(() => {
    if (!selectedWorktreeId) return undefined;
    const timer = window.setInterval(() => void loadWorktreeData(selectedWorktreeId, true), 2500);
    return () => window.clearInterval(timer);
  }, [selectedWorktreeId, loadWorktreeData]);

  const createTerminal = async (): Promise<void> => {
    if (!selectedWorktree) return;
    markMutation();
    setBusy(true);
    try {
      const title = `Terminal ${terminals.filter((terminal) => terminal.kind === 'shell').length + 1}`;
      const response = await apiPost<{ data: TerminalInfo }>('/terminals', {
        worktreeId: selectedWorktree.id,
        title,
        cols: 120,
        rows: 32
      });
      markMutation();
      setTerminals((current) => [...current, response.data]);
      setActiveTerminalId(response.data.id);
    } catch (caught) {
      toastError(caught, 'Gagal membuka terminal.');
    } finally {
      setBusy(false);
    }
  };

  const closeTerminal = async (terminal: TerminalInfo): Promise<void> => {
    markMutation();
    try {
      await apiDelete(`/terminals/${terminal.id}`);
      markMutation();
      setTerminals((current) => current.filter((item) => item.id !== terminal.id));
      if (activeTerminalId === terminal.id) {
        const remaining = terminals.filter((item) => item.id !== terminal.id);
        setActiveTerminalId(remaining[0]?.id ?? null);
      }
    } catch (caught) {
      toastError(caught, 'Gagal menutup terminal.');
    }
  };

  const deleteWorktree = async (worktree: Worktree): Promise<void> => {
    markMutation();
    if (!window.confirm(`Hapus worktree ${worktree.branch}? Branch Git tidak dihapus.`)) return;
    try {
      await apiDelete(`/worktrees/${worktree.id}`);
      markMutation();
      setWorktrees((current) => current.filter((item) => item.id !== worktree.id));
      if (selectedWorktreeId === worktree.id) {
        setSelectedWorktreeId(null);
        setTerminals([]);
        setSessions([]);
        setActiveTerminalId(null);
      }
      push('success', 'Worktree dihapus.');
    } catch (caught) {
      toastError(caught, 'Gagal menghapus worktree.');
    }
  };

  const stopSession = async (session: SessionInfo): Promise<void> => {
    markMutation();
    setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, status: 'stopped' } : item)));
    try {
      await apiPost(`/sessions/${session.id}/stop`);
      push('success', 'Sesi dihentikan.');
    } catch (caught) {
      toastError(caught, 'Gagal menghentikan sesi.');
    }
  };

  const logout = async (): Promise<void> => {
    await apiPost('/auth/logout').catch(() => undefined);
    setUser(null);
    setProjects([]);
    setWorktrees([]);
    setTerminals([]);
    setSessions([]);
  };

  if (!booted) {
    return (
      <div className="boot">
        <Spinner /> Memuat Dorado...
      </div>
    );
  }

  if (!user) {
    return <Login onLoggedIn={(next) => setUser(next)} />;
  }

  const activeTerminal = terminals.find((terminal) => terminal.id === activeTerminalId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand-mark">D</span>
        <span className="topbar-title">Dorado</span>
        {selectedProject ? (
          <span className="muted" style={{ fontSize: 12 }}>
            / {selectedProject.name}
            {selectedWorktree ? <span className="mono"> · {selectedWorktree.branch}</span> : null}
          </span>
        ) : null}
        <span className="topbar-spacer" />
        <span className="topbar-status">
          <span className={`dot ${agents.some((agent) => agent.installed) ? '' : 'off'}`} />
          {agents.filter((agent) => agent.installed).length} agent siap
        </span>
        <button className="btn tiny" onClick={() => setDialog({ type: 'share' })}>
          Share
        </button>
        <button className="btn tiny ghost" onClick={() => void logout()}>
          Keluar
        </button>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="sidebar-head">
            <span className="sidebar-title">Projects</span>
            <button className="icon-btn" title="Tambah project" onClick={() => setDialog({ type: 'project' })}>
              +
            </button>
          </div>
          <div className="sidebar-body">
            {projects.length === 0 ? (
              <div className="empty">
                Belum ada project.
                <br />
                Tambahkan repository Git untuk mulai.
              </div>
            ) : (
              projects.map((project) => (
                <div className="project" key={project.id}>
                  <div
                    className={`project-row ${project.id === selectedProjectId ? 'active' : ''}`}
                    onClick={() => void selectProject(project)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void selectProject(project);
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="project-name">{project.name}</div>
                      <div className="project-path">{project.path}</div>
                    </div>
                  </div>

                  {project.id === selectedProjectId ? (
                    <>
                      <div style={{ padding: '4px 8px' }}>
                        <button className="btn tiny" onClick={() => setDialog({ type: 'worktree', project })}>
                          + Worktree
                        </button>
                      </div>
                      <div className="worktree-list">
                        {worktrees.length === 0 ? <div className="empty">Belum ada worktree.</div> : null}
                        {worktrees.map((worktree) => (
                          <div key={worktree.id}>
                            <div
                              className={`worktree-row ${worktree.id === selectedWorktreeId ? 'active' : ''}`}
                              onClick={() => void selectWorktree(worktree)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void selectWorktree(worktree);
                              }}
                            >
                              <span className="mono" style={{ color: 'var(--accent)' }}>
                                ⑂
                              </span>
                              <span className="branch">{worktree.branch}</span>
                              <span className={`badge ${worktree.status === 'ready' ? 'completed' : 'failed'}`}>
                                {worktree.status}
                              </span>
                              <button
                                className="icon-btn"
                                title="Hapus worktree"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void deleteWorktree(worktree);
                                }}
                              >
                                ×
                              </button>
                            </div>
                            {worktree.id === selectedWorktreeId ? (
                              <div className="session-list">
                                {sessions.map((session) => (
                                  <div
                                    key={session.id}
                                    className={`session-row ${session.terminalId === activeTerminalId ? 'active' : ''}`}
                                    onClick={() => {
                                      setActiveTerminalId(session.terminalId);
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') setActiveTerminalId(session.terminalId);
                                    }}
                                  >
                                    <span style={{ color: 'var(--accent-2)' }}>✦</span>
                                    <span className="name">{session.title}</span>
                                    <StatusBadge status={session.status} />
                                    {session.status === 'running' ? (
                                      <button
                                        className="icon-btn"
                                        title="Hentikan sesi"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void stopSession(session);
                                        }}
                                      >
                                        ■
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                                {sessions.length === 0 ? <div className="empty">Belum ada sesi agent.</div> : null}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="content">
          <div className="tabs">
            {terminals.length === 0 ? <span className="tabs-empty">Tidak ada terminal terbuka</span> : null}
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`tab ${terminal.id === activeTerminalId ? 'active' : ''}`}
                onClick={() => setActiveTerminalId(terminal.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setActiveTerminalId(terminal.id);
                }}
              >
                <span style={{ color: terminal.kind === 'agent' ? 'var(--accent-2)' : 'var(--muted-2)' }}>
                  {terminal.kind === 'agent' ? '✦' : '>_'}
                </span>
                <span className="tab-label">{terminal.title}</span>
                {terminal.status !== 'running' ? <span className="badge exited">off</span> : null}
                <button
                  className="tab-close"
                  aria-label={`Tutup ${terminal.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTerminal(terminal);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="terminal-area">
            {activeTerminal ? (
              <TerminalPane key={activeTerminal.id} terminalId={activeTerminal.id} />
            ) : (
              <div className="welcome">
                <h2>{selectedWorktree ? 'Siap bekerja' : 'Pilih atau buat worktree'}</h2>
                <p>
                  {selectedWorktree
                    ? 'Buka terminal shell atau jalankan agent pada worktree ini.'
                    : 'Tambahkan project Git, buat worktree terisolasi, lalu jalankan beberapa agent secara paralel.'}
                </p>
                {selectedWorktree ? (
                  <div className="row">
                    <button className="btn" disabled={busy} onClick={() => void createTerminal()}>
                      + Terminal
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => setDialog({ type: 'session', worktree: selectedWorktree })}
                    >
                      ✦ Jalankan Agent
                    </button>
                  </div>
                ) : selectedProject ? (
                  <button className="btn" onClick={() => setDialog({ type: 'worktree', project: selectedProject })}>
                    + Worktree
                  </button>
                ) : (
                  <button className="btn" onClick={() => setDialog({ type: 'project' })}>
                    + Tambah Project
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span className="mono">{selectedWorktree?.path ?? '—'}</span>
            <span className="spacer" />
            <span>{terminals.filter((terminal) => terminal.status === 'running').length} terminal aktif</span>
            <span>{sessions.filter((session) => session.status === 'running').length} agent berjalan</span>
          </footer>
        </section>
      </div>

      {selectedWorktree ? (
        <div style={{ position: 'fixed', right: 18, bottom: 38, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void createTerminal()} disabled={busy}>
            + Terminal
          </button>
          <button className="btn primary" onClick={() => setDialog({ type: 'session', worktree: selectedWorktree })}>
            ✦ Jalankan Agent
          </button>
        </div>
      ) : null}

      {dialog?.type === 'project' ? (
        <AddProjectDialog
          onClose={() => setDialog(null)}
          onCreated={(project) => {
            void loadProjects().then(() => void selectProject(project));
            push('success', 'Project ditambahkan.');
          }}
        />
      ) : null}

      {dialog?.type === 'worktree' ? (
        <NewWorktreeDialog
          project={dialog.project}
          onClose={() => setDialog(null)}
          onCreated={(worktree) => {
            void selectProject(dialog.project).then(() => void selectWorktree(worktree));
            push('success', 'Worktree dibuat.');
          }}
        />
      ) : null}

      {dialog?.type === 'session' ? (
        <NewSessionDialog
          worktree={dialog.worktree}
          agents={agents}
          onClose={() => setDialog(null)}
          onCreated={(session) => {
            markMutation();
            setSessions((current) => [session, ...current]);
            setActiveTerminalId(session.terminalId);
            void loadWorktreeData(session.worktreeId);
            push('success', 'Agent dijalankan.');
          }}
        />
      ) : null}

      {dialog?.type === 'share' ? <ShareDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}