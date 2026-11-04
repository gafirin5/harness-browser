import { Router } from 'express';
import { z } from 'zod';
import { sessionCreateSchema, type SessionHistoryItem, type SessionInfo } from '@dorado/shared';
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

const historyQuerySchema = z.object({
  q: z.string().max(200).optional().default(''),
  status: z.enum(['running', 'completed', 'failed', 'stopped']).optional(),
  agent: z.string().max(60).optional(),
  projectId: z.string().max(40).optional(),
  worktreeId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

interface HistoryRow extends SessionRow {
  project_id: string;
  project_name: string;
  worktree_branch: string;
}

function mapHistory(row: HistoryRow): SessionHistoryItem {
  return {
    ...mapSession(row),
    projectId: row.project_id,
    projectName: row.project_name,
    worktreeBranch: row.worktree_branch
  };
}

export const agentsRouter = Router();
agentsRouter.use(csrfGuard, requireAuth);
agentsRouter.get('/', (_req, res) => {
  res.json({ data: listAgents() });
});

export const sessionsRouter = Router();
sessionsRouter.use(csrfGuard, requireAuth);

sessionsRouter.get('/history', (req, res) => {
  const query = parseWith(historyQuerySchema, req.query);
  const where: string[] = ['1=1'];
  const params: Array<string | number | null> = [];
  if (query.q) {
    const pattern = `%${query.q.toLowerCase()}%`;
    where.push('(lower(s.title) LIKE ? OR lower(s.prompt) LIKE ?)');
    params.push(pattern, pattern);
  }
  if (query.status) {
    where.push('s.status = ?');
    params.push(query.status);
  }
  if (query.agent) {
    where.push('s.agent = ?');
    params.push(query.agent);
  }
  if (query.projectId) {
    where.push('w.project_id = ?');
    params.push(query.projectId);
  }
  if (query.worktreeId) {
    where.push('s.worktree_id = ?');
    params.push(query.worktreeId);
  }
  const whereSql = where.join(' AND ');
  const countRow = db
    .prepare(
      `SELECT count(*) AS total FROM sessions s
       JOIN worktrees w ON w.id = s.worktree_id
       JOIN projects p ON p.id = w.project_id
       WHERE ${whereSql}`
    )
    .get(...params) as { total: number } | undefined;
  const rows = db
    .prepare(
      `SELECT s.*, w.project_id, w.branch AS worktree_branch, p.name AS project_name
       FROM sessions s
       JOIN worktrees w ON w.id = s.worktree_id
       JOIN projects p ON p.id = w.project_id
       WHERE ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, query.page_size, (query.page - 1) * query.page_size) as unknown as HistoryRow[];
  const total = countRow?.total ?? 0;
  res.json({
    data: rows.map(mapHistory),
    meta: {
      page: query.page,
      pageSize: query.page_size,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.page_size))
    }
  });
});

sessionsRouter.get('/', (req, res) => {
  const worktreeId = typeof req.query.worktreeId === 'string' ? req.query.worktreeId : null;
  const rows = (worktreeId
    ? db.prepare('SELECT * FROM sessions WHERE worktree_id = ? ORDER BY created_at DESC').all(worktreeId)
    : db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all()) as unknown as unknown as SessionRow[];
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

sessionsRouter.post(
  '/:id/resume',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(req.params.id ?? '')) as
      | SessionRow
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    if (row.status === 'running') throw new AppError(422, 'SESSION_RUNNING', 'Sesi masih berjalan.');
    const worktree = getWorktreeRow(row.worktree_id);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const agent = getAgent(row.agent);
    if (!agent) throw new AppError(422, 'UNKNOWN_AGENT', 'Agent tidak dikenal.');
    if (!agent.installed) {
      throw new AppError(422, 'AGENT_NOT_INSTALLED', `Agent ${agent.name} belum terpasang di host ini.`);
    }

    const terminal = terminalManager.create({
      worktreeId: worktree.id,
      title: `${row.title} (lanjut)`,
      kind: 'agent',
      command: agent.command,
      args: buildAgentArgs(agent.resumeArgs ?? agent.args, row.prompt),
      cols: 120,
      rows: 34
    });

    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`
    ).run(id, worktree.id, terminal.id, agent.id, `${row.title} (lanjut)`, row.prompt, createdAt, createdAt);

    const created = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow;
    res.status(201).json({ data: mapSession(created) });
  })
);

sessionsRouter.post('/:id/stop', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(req.params.id ?? '')) as unknown as
    | SessionRow
    | undefined;
  if (!row) throw notFound('Sesi tidak ditemukan.');
  terminalManager.stop(row.terminal_id);
  res.json({ data: mapSession(row) });
});
