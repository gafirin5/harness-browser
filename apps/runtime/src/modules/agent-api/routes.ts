import { Router } from 'express';
import { worktreeUpdateSchema } from '@dorado/shared';
import { db, nowIso } from '../../db/index.js';
import { hashAgentToken } from '../../lib/agent-token.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { getWorktreeRow } from '../worktrees/routes.js';

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
