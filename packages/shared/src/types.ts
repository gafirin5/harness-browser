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
  createdAt: string;
}

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
  installed: boolean;
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
