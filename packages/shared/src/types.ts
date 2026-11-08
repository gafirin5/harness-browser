export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Worktree {
  id: string;
  projectId: string;
  branch: string;
  path: string;
  baseRef: string;
  status: 'ready' | 'missing';
  taskStatus: WorktreeTaskStatus;
  note: string;
  createdAt: string;
}

export type WorktreeTaskStatus = 'todo' | 'in-progress' | 'in-review' | 'completed';

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  refs: string[];
  lane: number;
}

export interface GitGraphEdge {
  from: number;
  to: number;
  fromLane: number;
  toLane: number;
}

export interface GitGraph {
  commits: GitGraphCommit[];
  edges: GitGraphEdge[];
  maxLane: number;
  truncated: boolean;
}

export interface GitCommitFile {
  path: string;
  status: string;
}

export interface GitCommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  body: string;
  files: GitCommitFile[];
}

export type QuickCommandScope = 'global' | 'project';

export interface QuickCommand {
  id: string;
  scope: QuickCommandScope;
  projectId: string | null;
  label: string;
  command: string;
  createdAt: string;
}

export interface DiffComment {
  id: string;
  worktreeId: string;
  path: string;
  line: number;
  body: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Automation {
  id: string;
  projectId: string;
  worktreeId: string | null;
  name: string;
  schedule: string;
  prompt: string;
  agent: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  sessionId: string | null;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  refId: string | null;
  createdAt: string;
  read: boolean;
}

export type RemoteNodeStatus = 'online' | 'offline';

export interface RemoteNodeInfo {
  id: string;
  name: string;
  status: RemoteNodeStatus;
  hostname: string | null;
  platform: string | null;
  agents: AgentInfo[];
  latencyMs: number | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RemoteNodeCreated extends RemoteNodeInfo {
  token: string;
  pairCommand: string;
}

export interface NodeHelloParams {
  hostname: string;
  platform: string;
  version: string;
  agents: AgentInfo[];
}

export interface ControllerIdentity {
  id: string;
  name: string;
  url: string;
  version: string;
  hostname: string;
}

export interface NodeHelloResponse {
  status: string;
  controller?: ControllerIdentity;
}

export interface UpdateCommitInfo {
  hash: string;
  subject: string;
}

export interface UpdateStatusInfo {
  enabled: boolean;
  mode: string;
  repoRoot: string | null;
  branch: string;
  remote: string;
  currentVersion: string;
  currentCommit: string | null;
  currentSubject: string | null;
  currentTag: string | null;
  latestTag: string | null;
  upToDate: boolean;
  behindCount: number;
  commits: UpdateCommitInfo[];
  dirty: boolean;
  restartCommand: string | null;
  error: string | null;
}

export interface BuildInfoInfo {
  version: string;
  commit: string | null;
  subject: string | null;
  branch: string | null;
  tag: string | null;
  builtAt: string | null;
}

export interface UpdateHistoryEntry {
  at: string;
  from: { version: string; commit: string | null };
  to: { version: string; commit: string | null };
  ok: boolean;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string | null;
  type: string;
  vars: string[];
  hasCss: boolean;
}

export interface UpdateStepInfo {
  step: string;
  ok: boolean;
  output: string;
}

export interface UpdateResultInfo {
  ok: boolean;
  steps: UpdateStepInfo[];
  newCommit: string | null;
  restartRequired: boolean;
}

export interface NodeRpcRequest<T = unknown> {
  id: string;
  method: string;
  params?: T;
}

export interface NodeRpcResponse<T = unknown> {
  id: string;
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export type TerminalKind = 'shell' | 'agent';
export type TerminalStatus = 'running' | 'exited' | 'stopped';

export interface TerminalInfo {
  id: string;
  worktreeId: string;
  title: string;
  kind: TerminalKind;
  status: TerminalStatus;
  cols: number;
  rows: number;
  exitCode: number | null;
  createdAt: string;
}

export type SessionStatus = 'running' | 'completed' | 'failed' | 'stopped';

export interface SessionInfo {
  id: string;
  worktreeId: string;
  terminalId: string;
  agent: string;
  title: string;
  prompt: string;
  status: SessionStatus;
  model?: string;
  messageCount?: number;
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SessionHistoryItem extends SessionInfo {
  projectId: string;
  projectName: string;
  worktreeBranch: string;
  worktreePath: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  resumeArgs?: string[];
  interactiveArgs?: string[];
  docsUrl?: string;
  source?: 'builtin' | 'env' | 'custom';
  builtin?: boolean;
  installed: boolean;
}

export interface RaceEntry {
  id: string;
  worktreeId: string;
  agentId: string;
  sessionId: string;
  branch: string;
  status: 'running' | 'won' | 'lost';
  sessionStatus: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface Race {
  id: string;
  projectId: string;
  baseBranch: string;
  prompt: string;
  status: 'running' | 'completed';
  winnerWorktreeId: string | null;
  createdAt: string;
  entries: RaceEntry[];
}

export interface PairingTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type UserRole = 'ADMIN' | 'VIEWER';

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  totpEnabled: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
