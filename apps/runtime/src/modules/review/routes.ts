import { Router } from 'express';
import { z } from 'zod';
import { diffCommentCreateSchema, diffCommentUpdateSchema, type DiffComment } from '@dorado/shared';
import { db, newId, nowIso } from '../../db/index.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

interface DiffCommentRow {
  id: string;
  worktree_id: string;
  file_path: string;
  line_number: number;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

function mapRow(row: DiffCommentRow): DiffComment {
  return {
    id: row.id,
    worktreeId: row.worktree_id,
    path: row.file_path,
    line: row.line_number,
    body: row.body,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  };
}

const listQuery = z.object({
  worktreeId: z.string().min(1),
  path: z.string().max(1000).optional()
});

function resolveWorktree(worktreeId: string): string {
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  return worktree.id;
}

export const reviewRouter = Router();
reviewRouter.use(csrfGuard, requireAuth);

reviewRouter.get('/', (req, res) => {
  const query = parseWith(listQuery, req.query);
  resolveWorktree(query.worktreeId);
  const rows = (query.path
    ? db
        .prepare(
          'SELECT * FROM diff_comments WHERE worktree_id = ? AND file_path = ? ORDER BY line_number ASC, created_at ASC'
        )
        .all(query.worktreeId, query.path)
    : db
        .prepare('SELECT * FROM diff_comments WHERE worktree_id = ? ORDER BY file_path ASC, line_number ASC')
        .all(query.worktreeId)) as unknown as DiffCommentRow[];
  res.json({ data: rows.map(mapRow) });
});

reviewRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(diffCommentCreateSchema, req.body);
    resolveWorktree(body.worktreeId);
    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      'INSERT INTO diff_comments (id, worktree_id, file_path, line_number, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, body.worktreeId, body.path, body.line, body.body, createdAt);
    res.status(201).json({
      data: mapRow({
        id,
        worktree_id: body.worktreeId,
        file_path: body.path,
        line_number: body.line,
        body: body.body,
        created_at: createdAt,
        resolved_at: null
      })
    });
  })
);

reviewRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const existing = db.prepare('SELECT * FROM diff_comments WHERE id = ?').get(id) as unknown as
      | DiffCommentRow
      | undefined;
    if (!existing) throw notFound('Komentar tidak ditemukan.');
    const body = parseWith(diffCommentUpdateSchema, req.body);
    const resolvedAt = body.resolved === undefined ? existing.resolved_at : body.resolved ? nowIso() : null;
    db.prepare('UPDATE diff_comments SET body = ?, resolved_at = ? WHERE id = ?').run(
      body.body ?? existing.body,
      resolvedAt,
      id
    );
    const updated = db.prepare('SELECT * FROM diff_comments WHERE id = ?').get(id) as unknown as DiffCommentRow;
    res.json({ data: mapRow(updated) });
  })
);

reviewRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const existing = db.prepare('SELECT id FROM diff_comments WHERE id = ?').get(id);
    if (!existing) throw notFound('Komentar tidak ditemukan.');
    db.prepare('DELETE FROM diff_comments WHERE id = ?').run(id);
    res.status(204).end();
  })
);
