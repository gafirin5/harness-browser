import { Router } from 'express';
import { asyncHandler } from '../../lib/errors.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { applyUpdate, getUpdateStatus, restartRuntime } from './service.js';
import { readUpdateHistory } from './history.js';

export const updateRouter = Router();
updateRouter.use(csrfGuard, requireAuth);

updateRouter.get(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ data: await getUpdateStatus() });
  })
);

updateRouter.get('/history', requireAdmin, (_req, res) => {
  res.json({ data: readUpdateHistory(30) });
});

updateRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const result = await applyUpdate();
    res.json({ data: result });
    // Restart SETELAH respons terkirim agar request tidak terputus.
    if (result.ok && result.restartRequired) {
      setTimeout(() => {
        const plan = restartRuntime();
        if (plan.kind !== 'none') setTimeout(() => process.exit(0), 800);
      }, 500);
    }
  })
);

updateRouter.post('/restart', requireAdmin, (_req, res) => {
  const plan = restartRuntime();
  res.json({ data: { restarting: plan.kind !== 'none', plan: plan.kind } });
  if (plan.kind !== 'none') setTimeout(() => process.exit(0), 500);
});
