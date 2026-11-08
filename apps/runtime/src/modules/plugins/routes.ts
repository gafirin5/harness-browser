import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { installPlugin, listPlugins, pluginStyles, removePlugin } from './service.js';

const installSchema = z.object({
  manifest: z.object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, 'Id plugin harus slug huruf kecil/angka/tanda hubung.'),
    name: z.string().trim().min(1, 'Nama plugin wajib diisi.').max(60),
    version: z.string().trim().max(20).optional(),
    type: z.string().trim().max(30).optional(),
    cssVars: z.record(z.string().max(200)).optional()
  }),
  css: z.string().max(100000).optional()
});

export const pluginsRouter = Router();

// styles.css publik (tanpa auth) agar <link> tidak memicu error 401 JSON.
pluginsRouter.get('/styles.css', (_req, res) => {
  res.type('text/css').send(pluginStyles());
});

pluginsRouter.use(csrfGuard, requireAuth);

pluginsRouter.get('/', (_req, res) => {
  res.json({ data: listPlugins() });
});

pluginsRouter.post('/', requireAdmin, (req, res) => {
  const body = parseWith(installSchema, req.body);
  if (body.manifest.id.endsWith('.css')) {
    throw new AppError(422, 'INVALID_PLUGIN_ID', 'Id plugin tidak valid.');
  }
  res.status(201).json({ data: installPlugin(body.manifest, body.css ?? '') });
});

pluginsRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!removePlugin(String(req.params.id ?? ''))) throw new AppError(404, 'NOT_FOUND', 'Plugin tidak ditemukan.');
  res.status(204).end();
});
