import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { sessionCreateSchema, type SessionHistoryItem, type SessionInfo } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { createAgentToken } from '../../lib/agent-token.js';
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
  model?: string;
  message_count?: number;
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
    model: row.model ?? '',
    messageCount: row.message_count ?? 0,
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
  worktree_path: string;
}

function mapHistory(row: HistoryRow): SessionHistoryItem {
  return {
    ...mapSession(row),
    projectId: row.project_id,
    projectName: row.project_name,
    worktreeBranch: row.worktree_branch,
    worktreePath: row.worktree_path
  };
}

const transcriptQuerySchema = z.object({
  q: z.string().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(500).default(200)
});

const inboxReadSchema = z.object({ sessionId: z.string().min(1) });
const inboxReadAllSchema = z.object({ sessionIds: z.array(z.string().min(1)).max(200) });

function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
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
      `SELECT s.*, w.project_id, w.branch AS worktree_branch, w.path AS worktree_path, p.name AS project_name
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

sessionsRouter.get(
  '/:id/transcript',
  asyncHandler(async (req, res) => {
    const query = parseWith(transcriptQuerySchema, req.query);
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(req.params.id ?? '')) as unknown as
      | SessionRow
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    const logPath = path.join(config.logsDir, `${row.terminal_id}.log`);
    if (!fs.existsSync(logPath)) {
      res.json({ data: { available: false, total: 0, truncated: false, lines: [] } });
      return;
    }
    const raw = fs.readFileSync(logPath, 'utf8');
    const maxBytes = 2 * 1024 * 1024;
    const truncated = raw.length > maxBytes;
    const content = truncated ? raw.slice(-maxBytes) : raw;
    const needle = query.q.toLowerCase();
    const lines = stripAnsi(content)
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }))
      .filter((item) => !needle || item.text.toLowerCase().includes(needle));
    res.json({
      data: {
        available: true,
        total: lines.length,
        truncated,
        lines: lines.slice(-query.limit)
      }
    });
  })
);

sessionsRouter.get('/inbox', (req, res) => {
  const user = res.locals.user as { id?: number } | undefined;
  const userId = Number(user?.id ?? 0);
  const rows = db.prepare("SELECT id FROM sessions WHERE status IN ('completed','failed')").all() as unknown as Array<{
    id: string;
  }>;
  const readIds = db
    .prepare(
      `SELECT r.session_id FROM inbox_reads r
       JOIN sessions s ON s.id = r.session_id
       WHERE r.user_id = ? AND s.status IN ('completed','failed')`
    )
    .all(userId) as unknown as Array<{ session_id: string }>;
  const readSet = new Set(readIds.map((row) => row.session_id));
  res.json({
    data: {
      total: rows.length,
      unreadCount: rows.filter((row) => !readSet.has(row.id)).length,
      readIds: Array.from(readSet)
    }
  });
});

sessionsRouter.post('/inbox/read', (req, res) => {
  const body = parseWith(inboxReadSchema, req.body);
  const user = res.locals.user as { id?: number } | undefined;
  const userId = Number(user?.id ?? 0);
  const exists = db.prepare('SELECT id FROM sessions WHERE id = ?').get(body.sessionId);
  if (!exists) throw notFound('Sesi tidak ditemukan.');
  db.prepare('INSERT OR IGNORE INTO inbox_reads (user_id, session_id, read_at) VALUES (?, ?, ?)').run(
    userId,
    body.sessionId,
    nowIso()
  );
  res.json({ data: { ok: true } });
});

sessionsRouter.post('/inbox/read-all', (req, res) => {
  const body = parseWith(inboxReadAllSchema, req.body);
  const user = res.locals.user as { id?: number } | undefined;
  const userId = Number(user?.id ?? 0);
  const now = nowIso();
  const insert = db.prepare('INSERT OR IGNORE INTO inbox_reads (user_id, session_id, read_at) VALUES (?, ?, ?)');
  for (const sessionId of body.sessionIds) {
    insert.run(userId, sessionId, now);
  }
  res.json({ data: { ok: true, count: body.sessionIds.length } });
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

    const id = newId();
    const agentToken = createAgentToken();
    const terminal = terminalManager.create({
      worktreeId: worktree.id,
      title: body.title,
      kind: 'agent',
      command: agent.command,
      args: buildAgentArgs(agent.args, body.prompt),
      cols: 120,
      rows: 34,
      env: {
        DORADO_SESSION_ID: id,
        DORADO_SESSION_TOKEN: agentToken.token,
        DORADO_WORKTREE_ID: worktree.id,
        DORADO_API_URL: config.publicBaseUrl
      }
    });

    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, agent_token_hash, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`
    ).run(id, worktree.id, terminal.id, agent.id, body.title, body.prompt, agentToken.hash, createdAt, createdAt);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow;
    res.status(201).json({ data: mapSession(row) });
  })
);

sessionsRouter.post(
  '/purge',
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        worktreeId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional()
      })
      .refine((data) => data.worktreeId || data.projectId, 'Pilih worktree atau project.')
      .parse(req.body);
    const where = ["s.status != 'running'"];
    const params: string[] = [];
    if (body.worktreeId) {
      where.push('s.worktree_id = ?');
      params.push(body.worktreeId);
    } else if (body.projectId) {
      where.push('w.project_id = ?');
      params.push(body.projectId);
    }
    const rows = db
      .prepare(
        `SELECT s.id, s.terminal_id FROM sessions s
         JOIN worktrees w ON w.id = s.worktree_id
         WHERE ${where.join(' AND ')}`
      )
      .all(...params) as unknown as Array<{ id: string; terminal_id: string }>;
    for (const row of rows) {
      db.prepare('UPDATE automation_runs SET session_id = NULL WHERE session_id = ?').run(row.id);
      terminalManager.remove(row.terminal_id);
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    }
    res.json({ data: { deleted: rows.length } });
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

    const id = newId();
    const agentToken = createAgentToken();
    const terminal = terminalManager.create({
      worktreeId: worktree.id,
      title: `${row.title} (lanjut)`,
      kind: 'agent',
      command: agent.command,
      args: buildAgentArgs(agent.resumeArgs ?? agent.args, row.prompt),
      cols: 120,
      rows: 34,
      env: {
        DORADO_SESSION_ID: id,
        DORADO_SESSION_TOKEN: agentToken.token,
        DORADO_WORKTREE_ID: worktree.id,
        DORADO_API_URL: config.publicBaseUrl
      }
    });

    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, agent_token_hash, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`
    ).run(
      id,
      worktree.id,
      terminal.id,
      agent.id,
      `${row.title} (lanjut)`,
      row.prompt,
      agentToken.hash,
      createdAt,
      createdAt
    );

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

sessionsRouter.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(String(req.params.id ?? '')) as unknown as
    | SessionRow
    | undefined;
  if (!row) throw notFound('Sesi tidak ditemukan.');
  if (row.status === 'running') {
    throw new AppError(409, 'SESSION_RUNNING', 'Hentikan sesi terlebih dahulu sebelum menghapus.');
  }
  db.prepare('UPDATE automation_runs SET session_id = NULL WHERE session_id = ?').run(row.id);
  terminalManager.remove(row.terminal_id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
  res.status(204).end();
});
