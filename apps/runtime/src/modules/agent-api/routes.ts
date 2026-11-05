import { Router } from 'express';
import { z } from 'zod';
import { worktreeUpdateSchema } from '@dorado/shared';
import { db, nowIso } from '../../db/index.js';
import { hashAgentToken } from '../../lib/agent-token.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const sessionUpdateSchema = z
  .object({
    model: z.string().trim().max(100).optional(),
    messageCount: z.coerce.number().int().min(0).max(1_000_000).optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

function resolveSession(req: { get: (name: string) => string | undefined }): { id: string; worktreeId: string } {
  const header = req.get('x-dorado-session-token') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AppError(401, 'AGENT_TOKEN_MISSING', 'Header x-dorado-session-token wajib diisi.');
  const row = db
    .prepare('SELECT id, worktree_id FROM sessions WHERE agent_token_hash = ?')
    .get(hashAgentToken(token)) as { id: string; worktree_id: string } | undefined;
  if (!row) throw new AppError(401, 'AGENT_TOKEN_INVALID', 'Token sesi agent tidak valid.');
  return { id: row.id, worktreeId: row.worktree_id };
}

export const agentApiRouter = Router();

agentApiRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const row = db
      .prepare('SELECT id, worktree_id, model, message_count, status FROM sessions WHERE id = ?')
      .get(session.id) as
      | { id: string; worktree_id: string; model: string; message_count: number; status: string }
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    res.json({
      data: {
        id: row.id,
        worktreeId: row.worktree_id,
        status: row.status,
        model: row.model,
        messageCount: row.message_count
      }
    });
  })
);

agentApiRouter.patch(
  '/session',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const row = db.prepare('SELECT id, model, message_count FROM sessions WHERE id = ?').get(session.id) as
      | { id: string; model: string; message_count: number }
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    const body = parseWith(sessionUpdateSchema, req.body);
    const model = body.model ?? row.model;
    const messageCount = body.messageCount ?? row.message_count;
    db.prepare('UPDATE sessions SET model = ?, message_count = ? WHERE id = ?').run(model, messageCount, row.id);
    res.json({ data: { id: row.id, model, messageCount, updatedAt: nowIso() } });
  })
);

agentApiRouter.get(
  '/worktree',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const worktree = getWorktreeRow(session.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    res.json({
      data: {
        id: worktree.id,
        branch: worktree.branch,
        taskStatus: worktree.task_status,
        note: worktree.note,
        sessionId: session.id,
        updatedAt: nowIso()
      }
    });
  })
);

agentApiRouter.patch(
  '/worktree',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const worktree = getWorktreeRow(session.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const body = parseWith(worktreeUpdateSchema, req.body);
    db.prepare('UPDATE worktrees SET task_status = ?, note = ? WHERE id = ?').run(
      body.taskStatus ?? worktree.task_status,
      body.note ?? worktree.note,
      worktree.id
    );
    const updated = getWorktreeRow(worktree.id);
    if (!updated) throw notFound('Worktree tidak ditemukan.');
    res.json({
      data: {
        id: updated.id,
        branch: updated.branch,
        taskStatus: updated.task_status,
        note: updated.note,
        sessionId: session.id,
        updatedAt: nowIso()
      }
    });
  })
);
