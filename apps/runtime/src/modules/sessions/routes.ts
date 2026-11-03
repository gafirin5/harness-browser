import { Router } from 'express';
import { sessionCreateSchema, type SessionInfo } from '@dorado/shared';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { terminalManager } from '../terminals/manager.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { buildAgentArgs, getAgent, listAgents } from './agents.js';

interface SessionRow {
  id: string;
  worktree_id: string;
  terminal_id: string;
  agent: string;
  title: string;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  exit_code: number | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

function mapSession(row: SessionRow): SessionInfo {
  return {
    id: row.id,
    worktreeId: row.worktree_id,
    terminalId: row.terminal_id,
    agent: row.agent,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    exitCode: row.exit_code,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

export const agentsRouter = Router();
agentsRouter.use(csrfGuard, requireAuth);
agentsRouter.get('/', (_req, res) => {
  res.json({ data: listAgents() });
});

export const sessionsRouter = Router();
sessionsRouter.use(csrfGuard, requireAuth);

sessionsRouter.get('/', (req, res) => {
  const worktreeId = typeof req.query.worktreeId === 'string' ? req.query.worktreeId : null;
  const rows = (
    worktreeId
      ? db.prepare('SELECT * FROM sessions WHERE worktree_id = ? ORDER BY created_at DESC').all(worktreeId)
      : db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all()
  ) as unknown as unknown as SessionRow[];
  res.json({ data: rows.map(mapSession) });
});

sessionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(sessionCreateSchema, req.body);
    const worktree = getWorktreeRow(body.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const agent = getAgent(body.agent);
    if (!agent) throw new AppError(422, 'UNKNOWN_AGENT', 'Agent tidak dikenal.');
    if (!agent.installed) {
      throw new AppError(422, 'AGENT_NOT_INSTALLED', `Agent ${agent.name} belum terpasang di host ini.`);
    }

    const terminal = terminalManager.create({
      worktreeId: worktree.id,
      title: body.title,
      kind: 'agent',
      command: agent.command,
      args: buildAgentArgs(agent.args, body.prompt),
      cols: 120,
      rows: 34
    });

    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`
    ).run(id, worktree.id, terminal.id, agent.id, body.title, body.prompt, createdAt, createdAt);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow;
    res.status(201).json({ data: mapSession(row) });
  })
);

sessionsRouter.post('/:id/stop', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(req.params.id ?? '')) as unknown as SessionRow | undefined;
  if (!row) throw notFound('Sesi tidak ditemukan.');
  terminalManager.stop(row.terminal_id);
  res.json({ data: mapSession(row) });
});