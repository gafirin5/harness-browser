import { Router } from 'express';
import { terminalCreateSchema } from '@dorado/shared';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { terminalManager } from './manager.js';

export const terminalsRouter = Router();
terminalsRouter.use(csrfGuard, requireAuth);

terminalsRouter.get('/', (req, res) => {
  const worktreeId = typeof req.query.worktreeId === 'string' ? req.query.worktreeId : undefined;
  res.json({ data: terminalManager.list(worktreeId) });
});

terminalsRouter.post('/', (req, res) => {
  const body = parseWith(terminalCreateSchema, req.body);
  const terminal = terminalManager.create({
    worktreeId: body.worktreeId,
    title: body.title,
    kind: 'shell',
    command: process.env.SHELL || '/bin/bash',
    args: [],
    cols: body.cols,
    rows: body.rows
  });
  res.status(201).json({ data: terminal });
});

terminalsRouter.post('/:id/restart', (req, res) => {
  const cols = Number(req.body?.cols ?? 120);
  const rows = Number(req.body?.rows ?? 32);
  const terminal = terminalManager.restart(String(req.params.id ?? ''), Number.isFinite(cols) ? cols : 120, Number.isFinite(rows) ? rows : 32);
  res.json({ data: terminal });
});

terminalsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!terminalManager.getRow(String(req.params.id ?? ''))) throw notFound('Terminal tidak ditemukan.');
    terminalManager.remove(String(req.params.id ?? ''));
    res.status(204).end();
  })
);