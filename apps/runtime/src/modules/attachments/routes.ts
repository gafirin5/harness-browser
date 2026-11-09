import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { sanitizeAttachmentName, writeAttachment } from './service.js';

const querySchema = z.object({ name: z.string().trim().min(1).max(200) });

export const attachmentsRouter = Router();
attachmentsRouter.use(csrfGuard, requireAuth);

attachmentsRouter.post(
  '/worktrees/:id/attachments',
  express.raw({ type: 'application/octet-stream', limit: '6mb' }),
  asyncHandler(async (req, res) => {
    const worktree = getWorktreeRow(String(req.params.id ?? ''));
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const query = parseWith(querySchema, req.query);
    const name = sanitizeAttachmentName(query.name);
    const result = await writeAttachment(worktree.path, name, req.body as Buffer);
    res.status(201).json({ data: result });
  })
);
