import { Router } from 'express';
import { remoteNodeCreateSchema } from '@dorado/shared';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { nodeManager } from './manager.js';

export const nodesRouter = Router();
nodesRouter.use(csrfGuard, requireAuth);

nodesRouter.get('/', (_req, res) => {
  res.json({ data: nodeManager.list() });
});

nodesRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseWith(remoteNodeCreateSchema, req.body);
    const created = nodeManager.create(body.name);
    res.status(201).json({ data: created });
  })
);

nodesRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const ok = nodeManager.remove(id);
    if (!ok) throw notFound('Node tidak ditemukan.');
    res.status(204).end();
  })
);

nodesRouter.post(
  '/:id/token',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const rotated = nodeManager.rotateToken(id);
    if (!rotated) throw notFound('Node tidak ditemukan.');
    res.json({ data: rotated });
  })
);
