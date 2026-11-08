import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { clearLinearKey, linearKeyLast4, setLinearKey } from './service.js';

const keySchema = z.object({ apiKey: z.string().trim().min(8, 'API key minimal 8 karakter.').max(300) });

export const settingsRouter = Router();
settingsRouter.use(csrfGuard, requireAuth);

settingsRouter.get('/linear', (_req, res) => {
  const last4 = linearKeyLast4();
  res.json({ data: { configured: Boolean(last4), last4 } });
});

settingsRouter.put('/linear', requireAdmin, (req, res) => {
  const body = parseWith(keySchema, req.body);
  setLinearKey(body.apiKey);
  res.json({ data: { configured: true, last4: linearKeyLast4() } });
});

settingsRouter.delete('/linear', requireAdmin, (_req, res) => {
  clearLinearKey();
  res.status(204).end();
});
