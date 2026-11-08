import { Router } from 'express';
import { z } from 'zod';
import { db, nowIso } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';

const prefsSchema = z.record(z.unknown());

function currentUserId(res: { locals: Record<string, unknown> }): number {
  return Number((res.locals.user as { id?: number } | undefined)?.id ?? 0);
}

export const userRouter = Router();
userRouter.use(csrfGuard, requireAuth);

userRouter.get('/preferences', (_req, res) => {
  const row = db.prepare('SELECT json FROM user_preferences WHERE user_id = ?').get(currentUserId(res)) as
    | { json: string }
    | undefined;
  let data: unknown = {};
  if (row) {
    try {
      data = JSON.parse(row.json);
    } catch {
      data = {};
    }
  }
  res.json({ data });
});

userRouter.put('/preferences', (req, res) => {
  const body = parseWith(prefsSchema, req.body);
  const json = JSON.stringify(body);
  if (json.length > 20000) {
    throw new AppError(422, 'PREFERENCES_TOO_LARGE', 'Preferensi terlalu besar (maks 20 KB).');
  }
  db.prepare(
    `INSERT INTO user_preferences (user_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(currentUserId(res), json, nowIso());
  res.json({ data: body });
});
