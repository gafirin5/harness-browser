import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { createTunnel, getTunnel, listTunnels, removeTunnel, startTunnel } from './service.js';

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(80),
  host: z.string().trim().min(1, 'Host wajib diisi.').max(200),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  user: z.string().trim().min(1, 'User wajib diisi.').max(100),
  localPort: z.coerce.number().int().min(1).max(65535),
  remotePort: z.coerce.number().int().min(1).max(65535)
});

export const sshRouter = Router();
sshRouter.use(csrfGuard, requireAuth);

sshRouter.get('/', (_req, res) => {
  res.json({ data: listTunnels() });
});

sshRouter.post('/', requireAdmin, (req, res) => {
  const body = parseWith(createSchema, req.body);
  res.status(201).json({ data: createTunnel(body) });
});

sshRouter.post('/:id/restart', requireAdmin, (req, res) => {
  const id = String(req.params.id ?? '');
  startTunnel(id);
  const tunnel = getTunnel(id);
  if (!tunnel) throw notFound('Tunnel tidak ditemukan.');
  res.json({ data: tunnel });
});

sshRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!removeTunnel(String(req.params.id ?? ''))) throw notFound('Tunnel tidak ditemukan.');
  res.status(204).end();
});
