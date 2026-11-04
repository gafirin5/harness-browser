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
}

export interface AgentInfo {
  id: string;
  name: string;
  command: string;
  args: string[];
  installed: boolean;
}

export interface PairingTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface UserInfo {
  id: number;
  name: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
