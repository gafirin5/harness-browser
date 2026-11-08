import type { SessionInfo } from '@dorado/shared';
import path from 'node:path';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { createAgentToken } from '../../lib/agent-token.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getProject } from '../projects/routes.js';
import { getActiveProfileEnv } from '../profiles/service.js';
import { terminalManager } from '../terminals/manager.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { agentCommandArgs, getAgent, type AgentInvocationMode } from './agents.js';

export interface SessionRow {
  id: string;
  worktree_id: string;
  terminal_id: string;
  agent: string;
  title: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  model?: string;
  message_count?: number;
  exit_code: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export function mapSession(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    worktreeId: row.worktree_id,
    terminalId: row.terminal_id,
    agent: row.agent,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    model: row.model ?? '',
    messageCount: row.message_count ?? 0,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export interface StartAgentSessionInput {
  worktreeId: string;
  agentId: string;
  title: string;
  prompt?: string;
  mode?: AgentInvocationMode;
  parentSessionId?: string | null;
}

/**
 * Buat sesi agent baru: spawn terminal (kind 'agent') di worktree lalu catat
 * sesi di database. Env kerja (termasuk DORADO_*) disuntikkan ke PTY.
 */
export function startAgentSession(input: StartAgentSessionInput): SessionInfo {
  const worktree = getWorktreeRow(input.worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  const agent = getAgent(input.agentId);
  if (!agent) throw new AppError(422, 'UNKNOWN_AGENT', 'Agent tidak dikenal.');
  if (!agent.installed) {
    throw new AppError(422, 'AGENT_NOT_INSTALLED', `Agent ${agent.name} belum terpasang di host ini.`);
  }

  const project = getProject(worktree.project_id);
  const id = newId();
  const agentToken = createAgentToken();
  const profileEnv = getActiveProfileEnv(agent.id) ?? {};
  const terminal = terminalManager.create({
    worktreeId: worktree.id,
    title: input.title,
    kind: 'agent',
    command: agent.command,
    args: agentCommandArgs(agent, input.prompt ?? '', input.mode ?? 'run'),
    cols: 120,
    rows: 34,
    env: {
      ...profileEnv,
      DORADO_SESSION_ID: id,
      DORADO_SESSION_TOKEN: agentToken.token,
      DORADO_WORKTREE_ID: worktree.id,
      DORADO_API_URL: config.publicBaseUrl,
      ...(project ? { DORADO_PROJECT_ID: project.id } : {}),
      ...(config.cliBinDir ? { PATH: `${config.cliBinDir}${path.delimiter}${process.env.PATH ?? ''}` } : {})
    }
  });

  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, agent_token_hash, parent_session_id, created_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`
  ).run(
    id,
    worktree.id,
    terminal.id,
    agent.id,
    input.title,
    input.prompt ?? '',
    agentToken.hash,
    input.parentSessionId ?? null,
    createdAt,
    createdAt
  );

  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow;
  return mapSession(row);
}
