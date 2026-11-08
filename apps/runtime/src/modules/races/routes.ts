import { Router } from 'express';
import { raceApplySchema, raceCreateSchema } from '@dorado/shared';
import { asyncHandler } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { applyWinner, createRace, getRace, listRaces } from './service.js';

export const racesRouter = Router();
racesRouter.use(csrfGuard, requireAuth);

racesRouter.post(
  '/projects/:id/races',
  asyncHandler(async (req, res) => {
    const body = parseWith(raceCreateSchema, req.body);
    const race = await createRace(String(req.params.id ?? ''), body);
    res.status(201).json({ data: race });
  })
);

racesRouter.get(
  '/projects/:id/races',
  asyncHandler(async (req, res) => {
    res.json({ data: await listRaces(String(req.params.id ?? '')) });
  })
);

racesRouter.get(
  '/races/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await getRace(String(req.params.id ?? '')) });
  })
);

racesRouter.post(
  '/races/:id/apply-winner',
  asyncHandler(async (req, res) => {
    const body = parseWith(raceApplySchema, req.body);
    const race = await applyWinner(String(req.params.id ?? ''), body.worktreeId, body.cleanupLosers);
    res.json({ data: race });
  })
);
