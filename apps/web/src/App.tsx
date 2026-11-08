import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentInfo,
  NotificationItem,
  Project,
  RemoteNodeInfo,
  SessionHistoryItem,
  SessionInfo,
  TerminalInfo,
  UserInfo,
  Worktree
} from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost, setActiveNodeId as setActiveNodeApi } from './lib/api';
import { submitOnCtrlEnter } from './lib/keyboard';
import { loadTerminalPrefs, saveTerminalPrefs, type TerminalPrefs } from './lib/terminal-prefs';
import { actionForEvent, loadKeymap, saveKeymap, type Keymap } from './lib/keymap';
import { Login } from './components/Login';
import { FileEditor } from './components/FileEditor';
import { FileTree } from './components/FileTree';
import { ChangesPanel } from './components/ChangesPanel';
import { CommandPalette, type Command } from './components/CommandPalette';
import { GitHubDialog } from './components/GitHubDialog';
import { InfoDialog } from './components/InfoDialog';
import { SearchDialog } from './components/SearchDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { AddProjectDialog, NewSessionDialog, NewWorktreeDialog, ShareDialog } from './components/Dialogs';
import { Spinner, StatusBadge, useToast } from './components/ui';
import { WorktreeCheckpoint, checkpointLabel } from './components/WorktreeCheckpoint';

const OrchestratorPanel = lazy(() => import('./components/OrchestratorPanel'));
const AuditDialog = lazy(() => import('./components/AuditDialog'));
const GitGraphPanel = lazy(() =>
  import('./components/GitGraphPanel').then((module) => ({ default: module.GitGraphPanel }))
);
const AgentDashboard = lazy(() =>
  import('./components/AgentDashboard').then((module) => ({ default: module.AgentDashboard }))
);
const HistoryDialog = lazy(() =>
  import('./components/HistoryDialog').then((module) => ({ default: module.HistoryDialog }))
);
const QuickCommandsDialog = lazy(() =>
  import('./components/QuickCommandsDialog').then((module) => ({ default: module.QuickCommandsDialog }))
);
const AutomationsDialog = lazy(() =>
  import('./components/AutomationsDialog').then((module) => ({ default: module.AutomationsDialog }))
);
const TerminalSettingsDialog = lazy(() =>
  import('./components/TerminalSettingsDialog').then((module) => ({ default: module.TerminalSettingsDialog }))
);
const QuickOpenDialog = lazy(() =>
  import('./components/QuickOpenDialog').then((module) => ({ default: module.QuickOpenDialog }))
);
const DiffViewer = lazy(() => import('./components/DiffViewer').then((module) => ({ default: module.DiffViewer })));
const NodesDialog = lazy(() => import('./components/NodesDialog'));
const AgentsDialog = lazy(() =>
  import('./components/AgentsDialog').then((module) => ({ default: module.AgentsDialog }))
);
const TerminalPane = lazy(() =>
  import('./components/TerminalPane').then((module) => ({ default: module.TerminalPane }))
);
const RaceDialog = lazy(() => import('./components/RaceDialog').then((module) => ({ default: module.RaceDialog })));
const TriageDialog = lazy(() =>
  import('./components/TriageDialog').then((module) => ({ default: module.TriageDialog }))
);

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
  const [openFiles, setOpenFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [openDiffs, setOpenDiffs] = useState<string[]>([]);
  const [activeDiffPath, setActiveDiffPath] = useState<string | null>(null);
  const [splitTerminalIds, setSplitTerminalIds] = useState<string[]>([]);
  const [dirtyFiles, setDirtyFiles] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, boolean>>({});
  const sessionStatusRef = useRef<Record<string, SessionInfo['status']>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [orchestratorOpen, setOrchestratorOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gitGraphOpen, setGitGraphOpen] = useState(false);
  const [quickCommandsOpen, setQuickCommandsOpen] = useState(false);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  const [terminalPrefs, setTerminalPrefs] = useState<TerminalPrefs>(() => loadTerminalPrefs());
  const [keymap, setKeymap] = useState<Keymap>(() => loadKeymap());
  const [resetNonce, setResetNonce] = useState(0);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'board' | 'inbox'>('board');
  const [dashboardSessions, setDashboardSessions] = useState<SessionHistoryItem[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [inboxRead, setInboxRead] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [nodesOpen, setNodesOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [raceOpen, setRaceOpen] = useState(false);
  const [triageOpen, setTriageOpen] = useState(false);
  const [remoteNodes, setRemoteNodes] = useState<RemoteNodeInfo[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const shortcutRef = useRef({
    selectedWorktree: null as Worktree | null,
    terminals: [] as TerminalInfo[],
    openFiles: [] as Array<{ path: string; name: string }>,
    openDiffs: [] as string[],
    activeTerminalId: null as string | null,
    activeFilePath: null as string | null,
    activeDiffPath: null as string | null,
    createTerminal: (() => undefined) as () => void,
    openAgent: (() => undefined) as () => void,
    selectWorktree: ((_worktree: Worktree) => undefined) as (worktree: Worktree) => void,
    selectProject: ((_project: Project) => undefined) as (project: Project) => void,
    closeTerminal: ((_terminal: TerminalInfo) => undefined) as (terminal: TerminalInfo) => void,
    closeFile: ((_path: string) => undefined) as (path: string) => void,
    closeDiff: ((_path: string) => undefined) as (path: string) => void
  });
  const [fileJump, setFileJump] = useState<{ path: string; line: number; token: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [terminalVersion, setTerminalVersion] = useState(0);
  const [searchNonce, setSearchNonce] = useState(0);
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

  useEffect(() => {
    setActiveNodeApi(activeNodeId);
    if (!booted) return;
    setSelectedProjectId(null);
    setSelectedWorktreeId(null);
    setProjects([]);
    setWorktrees([]);
    setTerminals([]);
    setSessions([]);
    setActiveTerminalId(null);
    setOpenFiles([]);
    setActiveFilePath(null);
    setOpenDiffs([]);
    setActiveDiffPath(null);
    setSplitTerminalIds([]);
    void loadProjects().catch((caught: unknown) => toastError(caught, 'Gagal memuat project node.'));
  }, [activeNodeId, booted, loadProjects, toastError]);

  const selectProject = useCallback(
    async (project: Project) => {
      dataVersion.current += 1;
      setSelectedProjectId(project.id);
      setSelectedWorktreeId(null);
      setWorktrees([]);
      setTerminals([]);
      setSessions([]);
      setActiveTerminalId(null);
      setOpenFiles([]);
      setActiveFilePath(null);
      setOpenDiffs([]);
      setActiveDiffPath(null);
      setSplitTerminalIds([]);
      setDirtyFiles({});
      try {
        const response = await apiGet<{ data: Worktree[] }>(`/worktrees?projectId=${encodeURIComponent(project.id)}`);
        setWorktrees(response.data);
      } catch (caught) {
        toastError(caught, 'Gagal memuat worktree.');
      }
    },
    [toastError]
  );

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
        const nextStatuses: Record<string, SessionInfo['status']> = {};
        for (const session of sessionResponse.data) {
          nextStatuses[session.id] = session.status;
          if (sessionStatusRef.current[session.id] === 'running' && session.status !== 'running') {
            const label =
              session.status === 'completed' ? 'selesai' : session.status === 'failed' ? 'gagal' : 'dihentikan';
            push(session.status === 'failed' ? 'error' : 'success', `Sesi "${session.title}" ${label}.`);
            setUnread((current) => ({ ...current, [session.id]: true }));
          }
        }
        sessionStatusRef.current = nextStatuses;
        setSessions(sessionResponse.data);
        setActiveTerminalId((current) => {
          if (current && terminalResponse.data.some((terminal) => terminal.id === current)) return current;
          return terminalResponse.data[0]?.id ?? null;
        });
      } catch (caught) {
        if (!silent) toastError(caught, 'Gagal memuat terminal/sesi.');
      }
    },
    [toastError, push]
  );

  const selectWorktree = useCallback(
    async (worktree: Worktree) => {
      dataVersion.current += 1;
      setSelectedWorktreeId(worktree.id);
      setTerminals([]);
      setSessions([]);
      setActiveTerminalId(null);
      setOpenFiles([]);
      setActiveFilePath(null);
      setOpenDiffs([]);
      setActiveDiffPath(null);
      setSplitTerminalIds([]);
      setDirtyFiles({});
      await loadWorktreeData(worktree.id);
    },
    [loadWorktreeData]
  );

  const loadDashboardSessions = useCallback(
    async (silent = false) => {
      if (!silent) setDashboardLoading(true);
      try {
        const response = await apiGet<{ data: SessionHistoryItem[] }>('/sessions/history?page_size=100');
        setDashboardSessions(response.data);
      } catch (caught) {
        if (!silent) toastError(caught, 'Gagal memuat dashboard agent.');
      } finally {
        if (!silent) setDashboardLoading(false);
      }
    },
    [toastError]
  );

  const loadNotifications = useCallback(async () => {
    try {
      const response = await apiGet<{ data: NotificationItem[] }>('/notifications?limit=50');
      setNotifications(response.data);
    } catch {
      // Abaikan; notifikasi opsional.
    }
  }, []);

  const loadRemoteNodes = useCallback(async () => {
    try {
      const response = await apiGet<{ data: RemoteNodeInfo[] }>('/nodes');
      setRemoteNodes(response.data);
    } catch {
      // Abaikan bila belum login
    }
  }, []);

  useEffect(() => {
    if (!booted) return undefined;
    void loadDashboardSessions(true);
    void loadNotifications();
    void loadRemoteNodes();
    const timer = window.setInterval(() => {
      void loadDashboardSessions(true);
      void loadNotifications();
      void loadRemoteNodes();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [booted, loadDashboardSessions, loadNotifications, loadRemoteNodes]);

  const loadInboxReads = useCallback(async () => {
    try {
      const response = await apiGet<{ data: { readIds: string[] } }>('/sessions/inbox');
      setInboxRead(response.data.readIds);
    } catch {
      // Abaikan; inbox tetap menampilkan status belum dibaca.
    }
  }, []);

  useEffect(() => {
    if (!booted) return undefined;
    void loadInboxReads();
    return undefined;
  }, [booted, loadInboxReads]);

  const unreadInboxCount = useMemo(() => {
    const read = new Set(inboxRead);
    const sessionUnread = dashboardSessions.filter(
      (session) => (session.status === 'completed' || session.status === 'failed') && !read.has(session.id)
    ).length;
    return sessionUnread + notifications.filter((item) => !item.read).length;
  }, [dashboardSessions, inboxRead, notifications]);

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

  useEffect(() => {
    setSplitTerminalIds((current) => {
      const next = current.filter((id) => id !== activeTerminalId && terminals.some((terminal) => terminal.id === id));
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [terminals, activeTerminalId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (submitOnCtrlEnter(event)) return;

      const target = event.target;
      const editable =
        target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], .xterm');
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'k' && !editable) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (editable) return;
      const action = actionForEvent(keymap, event);
      if (!action) return;
      event.preventDefault();

      const state = shortcutRef.current;
      if (action === 'terminal') {
        state.createTerminal();
        return;
      }
      if (action === 'agent') {
        state.openAgent();
        return;
      }
      if (action === 'orchestrator') {
        setOrchestratorOpen(true);
        return;
      }
      if (action === 'github') {
        setGithubOpen(true);
        return;
      }
      if (action === 'gitGraph') {
        setGitGraphOpen(true);
        return;
      }
      if (action === 'history') {
        setHistoryOpen(true);
        return;
      }
      if (action === 'settings') {
        setSettingsOpen(true);
        return;
      }
      if (action === 'nodes') {
        setNodesOpen(true);
        return;
      }
      if (action === 'quickOpen') {
        setQuickOpen(true);
        return;
      }
      if (action === 'jump') {
        setJumpOpen(true);
        return;
      }
      if (action === 'shortcuts') {
        setShortcutsOpen(true);
        return;
      }

      const tabs = [
        ...state.terminals.map((terminal) => ({ kind: 'terminal' as const, id: terminal.id })),
        ...state.openFiles.map((file) => ({ kind: 'file' as const, id: file.path })),
        ...state.openDiffs.map((file) => ({ kind: 'diff' as const, id: file }))
      ];
      if (tabs.length === 0) return;
      const activeIndex = tabs.findIndex((tab) =>
        tab.kind === 'terminal'
          ? !state.activeFilePath && !state.activeDiffPath && tab.id === state.activeTerminalId
          : tab.kind === 'file'
            ? tab.id === state.activeFilePath
            : tab.id === state.activeDiffPath
      );
      if (action === 'closeTab') {
        if (state.activeFilePath) state.closeFile(state.activeFilePath);
        else if (state.activeDiffPath) state.closeDiff(state.activeDiffPath);
        else {
          const terminal = state.terminals.find((item) => item.id === state.activeTerminalId);
          if (terminal) state.closeTerminal(terminal);
        }
        return;
      }
      const nextIndex =
        action === 'nextTab'
          ? (activeIndex + 1 + tabs.length) % tabs.length
          : (activeIndex - 1 + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (!next) return;
      if (next.kind === 'terminal') {
        setActiveTerminalId(next.id);
        setActiveFilePath(null);
        setActiveDiffPath(null);
      } else if (next.kind === 'file') {
        setActiveFilePath(next.id);
        setActiveDiffPath(null);
      } else {
        setActiveDiffPath(next.id);
        setActiveFilePath(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keymap]);

  useEffect(() => {
    const count = Object.keys(unread).length;
    document.title = count > 0 ? `(${count}) Dorado` : 'Dorado';
  }, [unread]);

  const openFile = useCallback((filePath: string, name: string) => {
    setOpenFiles((current) =>
      current.some((file) => file.path === filePath) ? current : [...current, { path: filePath, name }]
    );
    setActiveFilePath(filePath);
    setActiveDiffPath(null);
    setFileJump(null);
  }, []);

  const openFileAt = useCallback((filePath: string, line: number) => {
    setOpenFiles((current) =>
      current.some((file) => file.path === filePath)
        ? current
        : [...current, { path: filePath, name: filePath.split('/').pop() ?? filePath }]
    );
    setActiveFilePath(filePath);
    setActiveDiffPath(null);
    setFileJump({ path: filePath, line, token: Date.now() });
    setSearchOpen(false);
  }, []);

  const openDiff = useCallback(
    (filePath: string, staged: boolean) => {
      setOpenDiffs((current) => (current.includes(filePath) ? current : [...current, filePath]));
      setActiveDiffPath(filePath);
      setActiveFilePath(null);
      if (staged) push('info', 'Menampilkan diff staged.');
    },
    [push]
  );

  const addSplitPane = useCallback(() => {
    setActiveFilePath(null);
    setActiveDiffPath(null);
    const used = new Set([activeTerminalId, ...splitTerminalIds]);
    const next = terminals.find((terminal) => !used.has(terminal.id));
    if (splitTerminalIds.length >= 3) {
      push('info', 'Maksimal empat pane terminal.');
      return;
    }
    if (!next) {
      push('info', 'Tidak ada terminal lain. Buat terminal baru terlebih dahulu.');
      return;
    }
    setSplitTerminalIds((current) => [...current, next.id]);
  }, [splitTerminalIds, terminals, activeTerminalId, push]);

  const clearSplit = useCallback(() => {
    setSplitTerminalIds([]);
  }, []);

  const removeSplitPane = useCallback((terminalId: string) => {
    setSplitTerminalIds((current) => current.filter((id) => id !== terminalId));
  }, []);

  const setPaneAt = useCallback((index: number, terminalId: string) => {
    if (index === 0) {
      setActiveTerminalId(terminalId);
      setSplitTerminalIds((current) => current.filter((id) => id !== terminalId));
    } else {
      setSplitTerminalIds((current) => current.map((id, itemIndex) => (itemIndex === index - 1 ? terminalId : id)));
    }
  }, []);

  const closeDiff = (filePath: string): void => {
    setOpenDiffs((current) => current.filter((item) => item !== filePath));
    if (activeDiffPath === filePath) setActiveDiffPath(null);
  };

  const closeFile = (filePath: string): void => {
    if (dirtyFiles[filePath] && !window.confirm(`Tutup ${filePath}? Perubahan belum disimpan.`)) return;
    setOpenFiles((current) => current.filter((file) => file.path !== filePath));
    setDirtyFiles((current) => {
      const next = { ...current };
      delete next[filePath];
      return next;
    });
    if (activeFilePath === filePath) setActiveFilePath(null);
  };

  const markFileDirty = useCallback((filePath: string, dirty: boolean) => {
    setDirtyFiles((current) => {
      if (Boolean(current[filePath]) === dirty) return current;
      const next = { ...current };
      if (dirty) next[filePath] = true;
      else delete next[filePath];
      return next;
    });
  }, []);

  const handleFileRenamed = useCallback((from: string, to: string) => {
    const rebase = (value: string): string =>
      value === from ? to : value.startsWith(`${from}/`) ? `${to}${value.slice(from.length)}` : value;
    setOpenFiles((current) =>
      current.map((file) => {
        const nextPath = rebase(file.path);
        return nextPath === file.path ? file : { path: nextPath, name: nextPath.split('/').pop() ?? file.name };
      })
    );
    setOpenDiffs((current) => current.map(rebase));
    setActiveFilePath((current) => (current ? rebase(current) : current));
    setActiveDiffPath((current) => (current ? rebase(current) : current));
    setDirtyFiles((current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) next[rebase(key)] = value;
      return next;
    });
  }, []);

  const handleFileDeleted = useCallback((deletedPath: string) => {
    const matches = (value: string): boolean => value === deletedPath || value.startsWith(`${deletedPath}/`);
    setOpenFiles((current) => current.filter((file) => !matches(file.path)));
    setOpenDiffs((current) => current.filter((item) => !matches(item)));
    setActiveFilePath((current) => (current && matches(current) ? null : current));
    setActiveDiffPath((current) => (current && matches(current) ? null : current));
    setDirtyFiles((current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (!matches(key)) next[key] = value;
      }
      return next;
    });
  }, []);

  const rerunSession = async (session: SessionInfo): Promise<void> => {
    markMutation();
    try {
      const response = await apiPost<{ data: SessionInfo }>(`/sessions/${session.id}/resume`);
      setSessions((current) => [response.data, ...current]);
      setActiveTerminalId(response.data.terminalId);
      setActiveFilePath(null);
      setActiveDiffPath(null);
      await loadWorktreeData(session.worktreeId);
      push('success', 'Sesi dilanjutkan.');
    } catch (caught) {
      toastError(caught, 'Gagal menjalankan ulang sesi.');
    }
  };

  const rerunHistory = async (session: SessionHistoryItem): Promise<void> => {
    const project = projects.find((item) => item.id === session.projectId);
    if (!project) {
      push('error', 'Project untuk sesi ini sudah tidak ada.');
      return;
    }
    try {
      dataVersion.current += 1;
      setSelectedProjectId(project.id);
      setSelectedWorktreeId(session.worktreeId);
      setTerminals([]);
      setSessions([]);
      setActiveTerminalId(null);
      setActiveFilePath(null);
      setActiveDiffPath(null);
      setSplitTerminalIds([]);
      const worktreeResponse = await apiGet<{ data: Worktree[] }>(
        `/worktrees?projectId=${encodeURIComponent(project.id)}`
      );
      setWorktrees(worktreeResponse.data);
      await loadWorktreeData(session.worktreeId);
      markMutation();
      const response = await apiPost<{ data: SessionInfo }>(`/sessions/${session.id}/resume`);
      setSessions((current) => [response.data, ...current]);
      setActiveTerminalId(response.data.terminalId);
      setHistoryOpen(false);
      push('success', 'Sesi dilanjutkan.');
    } catch (caught) {
      toastError(caught, 'Gagal menjalankan ulang sesi.');
    }
  };

  const openDashboardSession = async (session: SessionHistoryItem): Promise<void> => {
    const project = projects.find((item) => item.id === session.projectId);
    if (!project) {
      push('error', 'Project untuk sesi ini sudah tidak ada.');
      return;
    }
    try {
      dataVersion.current += 1;
      setSelectedProjectId(project.id);
      setSelectedWorktreeId(session.worktreeId);
      setTerminals([]);
      setSessions([]);
      setActiveTerminalId(null);
      setActiveFilePath(null);
      setActiveDiffPath(null);
      setSplitTerminalIds([]);
      const worktreeResponse = await apiGet<{ data: Worktree[] }>(
        `/worktrees?projectId=${encodeURIComponent(project.id)}`
      );
      setWorktrees(worktreeResponse.data);
      await loadWorktreeData(session.worktreeId);
      setActiveTerminalId(session.terminalId);
      setActiveFilePath(null);
      setActiveDiffPath(null);
      setDashboardOpen(false);
    } catch (caught) {
      toastError(caught, 'Gagal membuka sesi.');
    }
  };

  const markInboxRead = (id: string): void => {
    setInboxRead((current) => (current.includes(id) ? current : [...current, id]));
    void apiPost('/sessions/inbox/read', { sessionId: id }).catch(() => undefined);
  };

  const markInboxAllRead = (ids: string[]): void => {
    setInboxRead((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return Array.from(next);
    });
    void apiPost('/sessions/inbox/read-all', { sessionIds: ids }).catch(() => undefined);
  };

  const markNotificationRead = (id: string): void => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    void apiPost(`/notifications/${id}/read`).catch(() => undefined);
  };

  const markAllNotificationsRead = (): void => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    void apiPost('/notifications/read-all').catch(() => undefined);
  };

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
      setActiveFilePath(null);
      setActiveDiffPath(null);
    } catch (caught) {
      toastError(caught, 'Gagal membuka terminal.');
    } finally {
      setBusy(false);
    }
  };

  const restartTerminal = async (terminal: TerminalInfo): Promise<void> => {
    markMutation();
    try {
      await apiPost(`/terminals/${terminal.id}/restart`, { cols: terminal.cols || 120, rows: terminal.rows || 32 });
      setTerminalVersion((value) => value + 1);
      await loadWorktreeData(terminal.worktreeId);
      push('success', 'Terminal di-restart.');
    } catch (caught) {
      toastError(caught, 'Gagal me-restart terminal.');
    }
  };

  const closeTerminal = async (terminal: TerminalInfo): Promise<void> => {
    markMutation();
    try {
      await apiDelete(`/terminals/${terminal.id}`);
      markMutation();
      setTerminals((current) => current.filter((item) => item.id !== terminal.id));
      setSplitTerminalIds((current) => current.filter((id) => id !== terminal.id));
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
      try {
        await apiDelete(`/worktrees/${worktree.id}`);
      } catch (caught) {
        if (
          caught instanceof ApiError &&
          caught.code === 'GIT_ERROR' &&
          window.confirm('Worktree memiliki perubahan yang belum di-commit. Hapus paksa? Data di worktree akan hilang.')
        ) {
          await apiDelete(`/worktrees/${worktree.id}?force=1`);
        } else {
          throw caught;
        }
      }
      markMutation();
      setWorktrees((current) => current.filter((item) => item.id !== worktree.id));
      if (selectedWorktreeId === worktree.id) {
        setSelectedWorktreeId(null);
        setTerminals([]);
        setSessions([]);
        setActiveTerminalId(null);
        setOpenFiles([]);
        setActiveFilePath(null);
      }
      push('success', 'Worktree dihapus.');
    } catch (caught) {
      toastError(caught, 'Gagal menghapus worktree.');
    }
  };

  const stopSession = async (session: SessionInfo): Promise<void> => {
    markMutation();
    sessionStatusRef.current[session.id] = 'stopped';
    setSessions((current) => current.map((item) => (item.id === session.id ? { ...item, status: 'stopped' } : item)));
    try {
      await apiPost(`/sessions/${session.id}/stop`);
      push('success', 'Sesi dihentikan.');
    } catch (caught) {
      toastError(caught, 'Gagal menghentikan sesi.');
    }
  };

  const deleteSession = async (session: SessionInfo): Promise<boolean> => {
    if (!window.confirm(`Hapus sesi "${session.title}"? Terminal agent dan riwayat sesi ini akan dihapus permanen.`)) {
      return false;
    }
    try {
      await apiDelete(`/sessions/${session.id}`);
      markMutation();
      delete sessionStatusRef.current[session.id];
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setTerminals((current) => current.filter((item) => item.id !== session.terminalId));
      setSplitTerminalIds((current) => current.filter((id) => id !== session.terminalId));
      setUnread((current) => {
        if (!current[session.id]) return current;
        const next = { ...current };
        delete next[session.id];
        return next;
      });
      if (activeTerminalId === session.terminalId) setActiveTerminalId(null);
      push('success', 'Sesi agent dihapus.');
      void loadDashboardSessions(true);
      return true;
    } catch (caught) {
      toastError(caught, 'Gagal menghapus sesi.');
      return false;
    }
  };

  const purgeSessions = async (scope: { worktreeId?: string; projectId?: string }): Promise<number | null> => {
    if (!window.confirm('Hapus semua sesi agent yang tidak sedang berjalan pada scope ini?')) return null;
    try {
      const response = await apiPost<{ data: { deleted: number } }>('/sessions/purge', scope);
      if (selectedWorktreeId) void loadWorktreeData(selectedWorktreeId);
      void loadDashboardSessions(true);
      push('success', `${response.data.deleted} sesi nonaktif dihapus.`);
      return response.data.deleted;
    } catch (caught) {
      toastError(caught, 'Gagal membersihkan sesi nonaktif.');
      return null;
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

  shortcutRef.current = {
    selectedWorktree,
    terminals,
    openFiles,
    openDiffs,
    activeTerminalId,
    activeFilePath,
    activeDiffPath,
    createTerminal: () => void createTerminal(),
    openAgent: () => {
      if (selectedWorktree) setDialog({ type: 'session', worktree: selectedWorktree });
    },
    selectWorktree: (worktree) => void selectWorktree(worktree),
    selectProject: (project) => void selectProject(project),
    closeTerminal: (terminal) => void closeTerminal(terminal),
    closeFile,
    closeDiff
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

  const paneIds = activeTerminalId
    ? [activeTerminalId, ...splitTerminalIds].filter((id, index, list) => list.indexOf(id) === index)
    : [];

  const commands: Command[] = [
    {
      id: 'project',
      label: 'Tambah Project',
      hint: 'Daftarkan repository Git lokal',
      run: () => setDialog({ type: 'project' })
    },
    ...(selectedProject
      ? [
          {
            id: 'worktree',
            label: 'Worktree Baru',
            hint: `Buat worktree untuk ${selectedProject.name}`,
            run: () => setDialog({ type: 'worktree', project: selectedProject })
          }
        ]
      : []),
    ...(selectedWorktree
      ? [
          {
            id: 'terminal',
            label: 'Terminal Baru',
            hint: 'Shell interaktif di worktree aktif',
            run: () => void createTerminal()
          },
          {
            id: 'agent',
            label: 'Jalankan Agent',
            hint: 'OpenCode di worktree aktif',
            run: () => setDialog({ type: 'session', worktree: selectedWorktree })
          },
          {
            id: 'pane',
            label: 'Tambah Pane Terminal',
            hint: 'Tampilkan terminal lain di pane baru',
            run: () => addSplitPane()
          },
          ...(splitTerminalIds.length > 0
            ? [
                {
                  id: 'unsplit',
                  label: 'Unsplit Terminal',
                  hint: 'Tutup semua pane tambahan',
                  run: () => clearSplit()
                }
              ]
            : []),
          {
            id: 'refresh',
            label: 'Muat Ulang Worktree',
            hint: 'Segarkan terminal dan sesi',
            run: () => void loadWorktreeData(selectedWorktree.id)
          }
        ]
      : []),
    {
      id: 'history',
      label: 'Riwayat Sesi Agent',
      hint: 'Cari dan jalankan ulang sesi sebelumnya',
      run: () => setHistoryOpen(true)
    },
    {
      id: 'orchestrator',
      label: 'Orchestrator',
      hint: 'Dashboard, provider, agent, dan task',
      run: () => setOrchestratorOpen(true)
    },
    {
      id: 'search',
      label: 'Cari Kode',
      hint: 'Pencarian teks/regex di seluruh worktree',
      run: () => setSearchOpen(true)
    },
    {
      id: 'quick-open',
      label: 'Quick Open File',
      hint: 'Lompat ke file berdasarkan nama (Alt+P)',
      run: () => setQuickOpen(true)
    },
    {
      id: 'jump',
      label: 'Jump ke Worktree / Tab',
      hint: 'Pindah cepat antar worktree dan tab (Alt+J)',
      run: () => setJumpOpen(true)
    },
    {
      id: 'shortcuts',
      label: 'Keyboard Shortcuts',
      hint: 'Daftar shortcut yang tersedia (Alt+/)',
      run: () => setShortcutsOpen(true)
    },
    {
      id: 'nodes',
      label: 'Kelola Remote Nodes',
      hint: 'Federasi mesin Dorado lain (Alt+N)',
      run: () => setNodesOpen(true)
    },
    {
      id: 'agents',
      label: 'Kelola Agent',
      hint: 'Preset & agent CLI kustom',
      run: () => setAgentsOpen(true)
    },
    {
      id: 'race',
      label: 'Worktree Racing',
      hint: 'Jalankan prompt di beberapa agent lalu merge pemenang',
      run: () => setRaceOpen(true)
    },
    {
      id: 'triage',
      label: 'Triage CI & Issue',
      hint: 'Perbaiki CI GitHub & buat worktree dari issue',
      run: () => setTriageOpen(true)
    },
    {
      id: 'git-graph',
      label: 'Git Graph',
      hint: 'Riwayat commit project dan detail per commit (Alt+Shift+G)',
      run: () => setGitGraphOpen(true)
    },
    {
      id: 'quick-commands',
      label: 'Quick Commands',
      hint: 'Simpan dan jalankan command yang sering dipakai',
      run: () => setQuickCommandsOpen(true)
    },
    {
      id: 'automations',
      label: 'Scheduled Automations',
      hint: 'Jalankan prompt agent sesuai jadwal',
      run: () => setAutomationsOpen(true)
    },
    {
      id: 'dashboard',
      label: 'Agent Dashboard',
      hint: 'Papan Needs You / Working / Done / Idle',
      run: () => {
        setDashboardTab('board');
        setDashboardOpen(true);
      }
    },
    {
      id: 'inbox',
      label: 'Agent Inbox',
      hint: 'Notifikasi sesi agent yang selesai atau gagal',
      run: () => {
        setDashboardTab('inbox');
        setDashboardOpen(true);
      }
    },
    {
      id: 'github',
      label: 'GitHub Repository',
      hint: 'Pull request dan issue untuk worktree aktif',
      run: () => setGithubOpen(true)
    },
    {
      id: 'info',
      label: 'Info Runtime',
      hint: 'Data directory, tmux, dan agent CLI',
      run: () => setInfoOpen(true)
    },
    {
      id: 'settings',
      label: 'Pengaturan Keamanan',
      hint: 'Ganti password dan cabut sesi lain',
      run: () => setSettingsOpen(true)
    },
    ...(user?.role === 'ADMIN'
      ? [
          {
            id: 'audit',
            label: 'Audit Log',
            hint: 'Riwayat login dan perubahan keamanan',
            run: () => setAuditOpen(true)
          }
        ]
      : []),
    {
      id: 'share',
      label: 'Share / Pairing Token',
      hint: 'Buat URL untuk browser lain',
      run: () => setDialog({ type: 'share' })
    }
  ];

  const jumpCommands: Command[] = [
    ...projects.map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      hint: `Project · ${project.path}`,
      run: () => void selectProject(project)
    })),
    ...worktrees.map((worktree) => ({
      id: `worktree:${worktree.id}`,
      label: worktree.branch,
      hint: `Worktree · ${worktree.path}`,
      run: () => void selectWorktree(worktree)
    })),
    ...terminals.map((terminal) => ({
      id: `terminal:${terminal.id}`,
      label: terminal.title,
      hint: terminal.kind === 'agent' ? 'Sesi agent' : 'Terminal',
      run: () => {
        setActiveFilePath(null);
        setActiveDiffPath(null);
        setActiveTerminalId(terminal.id);
        setSplitTerminalIds((current) => current.filter((id) => id !== terminal.id));
      }
    })),
    ...openFiles.map((file) => ({
      id: `file:${file.path}`,
      label: file.name,
      hint: `File · ${file.path}`,
      run: () => {
        setActiveDiffPath(null);
        setActiveFilePath(file.path);
      }
    })),
    ...openDiffs.map((filePath) => ({
      id: `diff:${filePath}`,
      label: filePath.split('/').pop() ?? filePath,
      hint: `Diff · ${filePath}`,
      run: () => {
        setActiveFilePath(null);
        setActiveDiffPath(filePath);
      }
    }))
  ];

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
        <button className="btn tiny" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+Shift+P)">
          ⌘K
        </button>
        <button className="btn tiny" onClick={() => setOrchestratorOpen(true)}>
          Orchestrator
        </button>
        <button className="btn tiny" onClick={() => setSearchOpen(true)} title="Cari kode (Ctrl+Shift+F)">
          Cari
        </button>
        <button className="btn tiny" onClick={() => setGithubOpen(true)}>
          GitHub
        </button>
        <button className="btn tiny" onClick={() => setInfoOpen(true)}>
          Info
        </button>
        <button
          className="btn tiny"
          onClick={() => {
            setDashboardTab('inbox');
            setDashboardOpen(true);
          }}
          title="Agent dashboard dan inbox"
        >
          Inbox{unreadInboxCount > 0 ? ` (${unreadInboxCount})` : ''}
        </button>
        <button className="btn tiny" onClick={() => setHistoryOpen(true)}>
          History
        </button>
        <button className="btn tiny" onClick={() => setDialog({ type: 'share' })}>
          Share
        </button>
        {user?.role === 'ADMIN' ? (
          <button className="btn tiny" onClick={() => setAuditOpen(true)}>
            Audit
          </button>
        ) : null}
        <button className="btn tiny" onClick={() => setNodesOpen(true)} title="Kelola Remote Nodes (Alt+N)">
          Nodes
          {remoteNodes.filter((n) => n.status === 'online').length > 0
            ? ` (${remoteNodes.filter((n) => n.status === 'online').length})`
            : ''}
        </button>
        <button className="btn tiny" onClick={() => setSettingsOpen(true)}>
          Setelan
        </button>
        <button className="btn tiny ghost" onClick={() => void logout()}>
          Keluar
        </button>
      </header>

      <div className="main">
        <aside className="sidebar">
          <div className="node-switcher">
            <span className="mono" style={{ fontSize: 11 }}>
              🌐 Node:
            </span>
            <select
              className="node-switcher-select"
              value={activeNodeId ?? ''}
              onChange={(e) => setActiveNodeId(e.target.value || null)}
              aria-label="Pilih host atau remote node"
            >
              <option value="">🖥️ Local</option>
              {remoteNodes.map((n) => (
                <option key={n.id} value={n.id} disabled={n.status !== 'online'}>
                  {n.name} ({n.status}
                  {n.status === 'online' && n.latencyMs !== null ? `, ${n.latencyMs}ms` : ''})
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => setNodesOpen(true)} title="Kelola Remote Nodes (Alt+N)">
              ⚙
            </button>
          </div>
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
                      <div style={{ padding: '4px 8px', display: 'flex', gap: 6 }}>
                        <button className="btn tiny" onClick={() => setDialog({ type: 'worktree', project })}>
                          + Worktree
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => {
                            void selectProject(project);
                            setGitGraphOpen(true);
                          }}
                          title="Git Graph (Alt+Shift+G)"
                        >
                          Graph
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => {
                            void selectProject(project);
                            setAutomationsOpen(true);
                          }}
                          title="Scheduled automations"
                        >
                          Auto
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
                              {worktree.status !== 'ready' ? <span className="badge failed">missing</span> : null}
                              <span
                                className={`checkpoint-badge ${worktree.taskStatus}`}
                                title={worktree.note || checkpointLabel(worktree.taskStatus)}
                              >
                                {checkpointLabel(worktree.taskStatus)}
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
                              <WorktreeCheckpoint
                                key={`checkpoint:${worktree.id}`}
                                worktree={worktree}
                                onUpdated={(next) =>
                                  setWorktrees((current) => current.map((item) => (item.id === next.id ? next : item)))
                                }
                              />
                            ) : null}
                            {worktree.id === selectedWorktreeId ? (
                              <div className="session-list">
                                {sessions.map((session) => (
                                  <div
                                    key={session.id}
                                    className={`session-row ${session.terminalId === activeTerminalId ? 'active' : ''} ${unread[session.id] ? 'unread' : ''}`}
                                    onClick={() => {
                                      setActiveFilePath(null);
                                      setActiveDiffPath(null);
                                      setActiveTerminalId(session.terminalId);
                                      setUnread((current) => {
                                        if (!current[session.id]) return current;
                                        const next = { ...current };
                                        delete next[session.id];
                                        return next;
                                      });
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        setActiveFilePath(null);
                                        setActiveDiffPath(null);
                                        setActiveTerminalId(session.terminalId);
                                      }
                                    }}
                                  >
                                    <span style={{ color: 'var(--accent-2)' }}>✦</span>
                                    <span className="name">
                                      {session.title}
                                      {unread[session.id] ? <span className="unread-dot" /> : null}
                                    </span>
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
                                    ) : (
                                      <button
                                        className="icon-btn"
                                        title="Jalankan ulang sesi"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void rerunSession(session);
                                        }}
                                      >
                                        ↻
                                      </button>
                                    )}
                                    {session.status !== 'running' ? (
                                      <button
                                        className="icon-btn danger"
                                        title="Hapus sesi"
                                        aria-label={`Hapus sesi ${session.title}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void deleteSession(session);
                                        }}
                                      >
                                        ×
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
            {selectedWorktree ? (
              <>
                <FileTree
                  key={selectedWorktree.id}
                  worktreeId={selectedWorktree.id}
                  onOpenFile={openFile}
                  onRenamed={handleFileRenamed}
                  onDeleted={handleFileDeleted}
                />
                <ChangesPanel
                  key={`changes:${selectedWorktree.id}`}
                  worktreeId={selectedWorktree.id}
                  onOpenDiff={openDiff}
                />
              </>
            ) : null}
          </div>
        </aside>

        <section className="content">
          <div className="tabs">
            {terminals.length === 0 && openFiles.length === 0 && openDiffs.length === 0 ? (
              <span className="tabs-empty">Tidak ada tab terbuka</span>
            ) : null}
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                className={`tab ${!activeFilePath && !activeDiffPath && terminal.id === activeTerminalId ? 'active' : ''}`}
                onClick={() => {
                  setActiveFilePath(null);
                  setActiveDiffPath(null);
                  setActiveTerminalId(terminal.id);
                  setSplitTerminalIds((current) => current.filter((id) => id !== terminal.id));
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setActiveFilePath(null);
                    setActiveDiffPath(null);
                    setActiveTerminalId(terminal.id);
                    setSplitTerminalIds((current) => current.filter((id) => id !== terminal.id));
                  }
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
            {openFiles.map((file) => (
              <div
                key={`file:${file.path}`}
                className={`tab ${activeFilePath === file.path ? 'active' : ''}`}
                onClick={() => {
                  setActiveFilePath(file.path);
                  setActiveDiffPath(null);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setActiveFilePath(file.path);
                    setActiveDiffPath(null);
                  }
                }}
              >
                <span style={{ color: 'var(--accent-2)' }}>▤</span>
                <span className="tab-label">
                  {dirtyFiles[file.path] ? '• ' : ''}
                  {file.name}
                </span>
                <button
                  className="tab-close"
                  aria-label={`Tutup ${file.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeFile(file.path);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {openDiffs.map((diffPath) => (
              <div
                key={`diff:${diffPath}`}
                className={`tab ${activeDiffPath === diffPath ? 'active' : ''}`}
                onClick={() => {
                  setActiveDiffPath(diffPath);
                  setActiveFilePath(null);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setActiveDiffPath(diffPath);
                    setActiveFilePath(null);
                  }
                }}
              >
                <span style={{ color: 'var(--danger)' }}>±</span>
                <span className="tab-label">{diffPath.split('/').pop()}</span>
                <button
                  className="tab-close"
                  aria-label={`Tutup diff ${diffPath}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeDiff(diffPath);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="tabs-actions">
              <button className="btn tiny" onClick={() => void createTerminal()} disabled={busy || !selectedWorktree}>
                + Terminal
              </button>
              <button
                className="btn tiny primary"
                onClick={() => selectedWorktree && setDialog({ type: 'session', worktree: selectedWorktree })}
                disabled={!selectedWorktree}
              >
                ✦ Agent
              </button>
              <button
                className="btn tiny"
                onClick={addSplitPane}
                disabled={splitTerminalIds.length >= 3 || terminals.length <= 1 + splitTerminalIds.length}
                title="Tambah pane terminal"
              >
                + Pane
              </button>
              {splitTerminalIds.length > 0 ? (
                <button className="btn tiny" onClick={clearSplit} title="Tutup semua pane tambahan">
                  Unsplit
                </button>
              ) : null}
              <button
                className="btn tiny"
                onClick={() => setSearchNonce((value) => value + 1)}
                disabled={!activeTerminal}
                title="Cari di terminal"
              >
                Find
              </button>
              <button className="btn tiny" onClick={() => setQuickCommandsOpen(true)} title="Quick commands">
                Commands
              </button>
              <button
                className="btn tiny"
                onClick={() => {
                  setResetNonce((value) => value + 1);
                  setSearchNonce(0);
                }}
                disabled={!activeTerminal}
                title="Reset terminal"
              >
                Reset
              </button>
              <button
                className="btn tiny"
                onClick={() => setTerminalSettingsOpen(true)}
                title="Tema, font, dan keymap terminal"
              >
                Tampilan
              </button>
            </div>
          </div>

          <div className="terminal-area">
            {activeTerminal && activeTerminal.status !== 'running' && !activeFilePath && !activeDiffPath ? (
              <div className="terminal-state">
                <span>Terminal berhenti.</span>
                {activeTerminal.kind === 'shell' ? (
                  <button className="btn tiny" onClick={() => void restartTerminal(activeTerminal)}>
                    Restart
                  </button>
                ) : (
                  <span className="muted">Jalankan ulang sesi dari sidebar/history.</span>
                )}
              </div>
            ) : null}
            {activeFilePath ? (
              <FileEditor
                key={`${selectedWorktreeId}:${activeFilePath}`}
                worktreeId={selectedWorktreeId ?? ''}
                filePath={activeFilePath}
                onDirtyChange={markFileDirty}
                jumpLine={fileJump?.path === activeFilePath ? fileJump.line : undefined}
                jumpToken={fileJump?.path === activeFilePath ? fileJump.token : undefined}
              />
            ) : activeDiffPath ? (
              <Suspense fallback={<div className="empty">Memuat diff...</div>}>
                <DiffViewer
                  key={`${selectedWorktreeId}:${activeDiffPath}`}
                  worktreeId={selectedWorktreeId ?? ''}
                  filePath={activeDiffPath}
                  initialStaged={false}
                  onSessionStarted={(session) => {
                    setSessions((current) => [session, ...current]);
                    setActiveTerminalId(session.terminalId);
                    setActiveFilePath(null);
                    setActiveDiffPath(null);
                    void loadWorktreeData(session.worktreeId);
                  }}
                />
              </Suspense>
            ) : activeTerminal ? (
              <div className={`terminal-panes panes-${paneIds.length}`}>
                {paneIds.map((terminalId, index) => {
                  const pane = terminals.find((terminal) => terminal.id === terminalId);
                  if (!pane) return null;
                  return (
                    <div className="terminal-slot" key={terminalId}>
                      {paneIds.length > 1 ? (
                        <div className="pane-head">
                          <span className="pane-title">{pane.title}</span>
                          <select
                            className="pane-select"
                            value={terminalId}
                            onChange={(event) => setPaneAt(index, event.target.value)}
                            aria-label={`Terminal pane ${index + 1}`}
                          >
                            {terminals.map((option) => (
                              <option
                                key={option.id}
                                value={option.id}
                                disabled={paneIds.includes(option.id) && option.id !== terminalId}
                              >
                                {option.title}
                              </option>
                            ))}
                          </select>
                          {index > 0 ? (
                            <button
                              className="pane-close"
                              onClick={() => removeSplitPane(terminalId)}
                              title="Tutup pane"
                            >
                              ×
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="pane-body">
                        <Suspense fallback={<div className="empty">Memuat terminal...</div>}>
                          <TerminalPane
                            key={`${terminalId}:${terminalVersion}`}
                            terminalId={terminalId}
                            active={index === 0}
                            searchNonce={index === 0 ? searchNonce : 0}
                            resetNonce={index === 0 ? resetNonce : 0}
                            prefs={terminalPrefs}
                          />
                        </Suspense>
                      </div>
                    </div>
                  );
                })}
              </div>
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

      {selectedWorktree && !activeFilePath && !activeDiffPath ? (
        <div style={{ position: 'fixed', right: 18, bottom: 38, display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void createTerminal()} disabled={busy}>
            + Terminal
          </button>
          <button className="btn primary" onClick={() => setDialog({ type: 'session', worktree: selectedWorktree })}>
            ✦ Jalankan Agent
          </button>
        </div>
      ) : null}

      {historyOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Riwayat Sesi...</div>
            </div>
          }
        >
          <HistoryDialog
            onClose={() => setHistoryOpen(false)}
            onRerun={rerunHistory}
            onDelete={deleteSession}
            onPurge={purgeSessions}
            selectedProjectId={selectedProjectId}
            selectedWorktreeId={selectedWorktreeId}
          />
        </Suspense>
      ) : null}
      {infoOpen ? (
        <InfoDialog
          onClose={() => setInfoOpen(false)}
          onManageAgents={() => (setInfoOpen(false), setAgentsOpen(true))}
        />
      ) : null}
      {agentsOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat agent...</div>
            </div>
          }
        >
          <AgentsDialog isAdmin={user?.role === 'ADMIN'} onClose={() => setAgentsOpen(false)} />
        </Suspense>
      ) : null}
      {raceOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat race...</div>
            </div>
          }
        >
          <RaceDialog projects={projects} agents={agents} onClose={() => setRaceOpen(false)} />
        </Suspense>
      ) : null}
      {triageOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat triage...</div>
            </div>
          }
        >
          <TriageDialog
            projects={projects}
            worktrees={worktrees}
            selectedProjectId={selectedProjectId}
            selectedWorktreeId={selectedWorktreeId}
            agents={agents}
            isAdmin={user?.role === 'ADMIN'}
            onClose={() => setTriageOpen(false)}
          />
        </Suspense>
      ) : null}
      {githubOpen ? <GitHubDialog worktreeId={selectedWorktreeId} onClose={() => setGithubOpen(false)} /> : null}
      {searchOpen ? (
        <SearchDialog worktreeId={selectedWorktreeId} onClose={() => setSearchOpen(false)} onOpen={openFileAt} />
      ) : null}
      {orchestratorOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Orchestrator...</div>
            </div>
          }
        >
          <OrchestratorPanel onClose={() => setOrchestratorOpen(false)} />
        </Suspense>
      ) : null}
      {settingsOpen && user ? (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          currentUser={user}
          onUserUpdated={(next) => setUser(next)}
        />
      ) : null}
      {auditOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Audit Log...</div>
            </div>
          }
        >
          <AuditDialog onClose={() => setAuditOpen(false)} />
        </Suspense>
      ) : null}
      {gitGraphOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Git Graph...</div>
            </div>
          }
        >
          <GitGraphPanel project={selectedProject} onClose={() => setGitGraphOpen(false)} />
        </Suspense>
      ) : null}
      {dashboardOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Agent Dashboard...</div>
            </div>
          }
        >
          <AgentDashboard
            sessions={dashboardSessions}
            loading={dashboardLoading}
            projects={projects}
            selectedProjectId={selectedProjectId}
            inboxRead={inboxRead}
            notifications={notifications}
            initialTab={dashboardTab}
            onClose={() => setDashboardOpen(false)}
            onRefresh={() => {
              void loadDashboardSessions();
              void loadNotifications();
            }}
            onOpenSession={(session) => void openDashboardSession(session)}
            onRerun={(session) => {
              setDashboardOpen(false);
              void rerunHistory(session);
            }}
            onStop={(session) => void stopSession(session).then(() => void loadDashboardSessions(true))}
            onMarkRead={markInboxRead}
            onMarkAllRead={markInboxAllRead}
            onMarkNotificationRead={markNotificationRead}
            onMarkAllNotificationsRead={markAllNotificationsRead}
          />
        </Suspense>
      ) : null}
      {nodesOpen && user ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Remote Nodes...</div>
            </div>
          }
        >
          <NodesDialog
            currentUser={user}
            activeNodeId={activeNodeId}
            onSelectNode={(id) => setActiveNodeId(id)}
            onClose={() => setNodesOpen(false)}
          />
        </Suspense>
      ) : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      {jumpOpen ? (
        <CommandPalette
          open
          onClose={() => setJumpOpen(false)}
          commands={jumpCommands}
          placeholder="Cari project, worktree, atau tab... (Alt+J)"
        />
      ) : null}
      {quickOpen ? (
        <Suspense
          fallback={
            <div className="palette-backdrop">
              <div className="empty">Memuat Quick Open...</div>
            </div>
          }
        >
          <QuickOpenDialog worktreeId={selectedWorktreeId} onClose={() => setQuickOpen(false)} onOpen={openFile} />
        </Suspense>
      ) : null}
      {shortcutsOpen ? (
        <ShortcutsDialog
          keymap={keymap}
          onClose={() => setShortcutsOpen(false)}
          onSave={(next) => {
            setKeymap(next);
            saveKeymap(next);
          }}
        />
      ) : null}
      {quickCommandsOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Quick Commands...</div>
            </div>
          }
        >
          <QuickCommandsDialog
            project={selectedProject}
            activeTerminal={activeTerminal}
            onClose={() => setQuickCommandsOpen(false)}
          />
        </Suspense>
      ) : null}
      {automationsOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat Automations...</div>
            </div>
          }
        >
          <AutomationsDialog
            project={selectedProject}
            worktrees={worktrees}
            onClose={() => setAutomationsOpen(false)}
            onRan={() => {
              if (selectedWorktree) void loadWorktreeData(selectedWorktree.id);
              void loadDashboardSessions(true);
            }}
          />
        </Suspense>
      ) : null}
      {terminalSettingsOpen ? (
        <Suspense
          fallback={
            <div className="orch-overlay">
              <div className="empty">Memuat pengaturan terminal...</div>
            </div>
          }
        >
          <TerminalSettingsDialog
            prefs={terminalPrefs}
            onClose={() => setTerminalSettingsOpen(false)}
            onSave={(next) => {
              setTerminalPrefs(next);
              saveTerminalPrefs(next);
            }}
          />
        </Suspense>
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
