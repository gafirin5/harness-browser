import { Router } from 'express';
import { z } from 'zod';
import type { NotificationItem } from '@dorado/shared';
import { db, nowIso } from '../../db/index.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { requireAuth } from '../auth/middleware.js';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  ref_id: string | null;
  created_at: string;
  read_at: string | null;
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

function userId(res: { locals: Record<string, unknown> }): number {
  const user = res.locals.user as { id?: number } | undefined;
  return Number(user?.id ?? 0);
}

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', (req, res) => {
  const query = parseWith(listQuery, req.query);
  const uid = userId(res);
  const rows = db
    .prepare(
      `SELECT n.*, r.read_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(uid, query.limit) as unknown as NotificationRow[];
  const data: NotificationItem[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    refId: row.ref_id,
    createdAt: row.created_at,
    read: Boolean(row.read_at)
  }));
  res.json({ data, meta: { unread: data.filter((item) => !item.read).length } });
});

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const existing = db.prepare('SELECT id FROM notifications WHERE id = ?').get(id);
    if (!existing) throw notFound('Notifikasi tidak ditemukan.');
    db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)').run(
      userId(res),
      id,
      nowIso()
    );
    res.json({ data: { ok: true } });
  })
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (_req, res) => {
    const uid = userId(res);
    const rows = db.prepare('SELECT id FROM notifications').all() as unknown as Array<{ id: string }>;
    const insert = db.prepare(
      'INSERT OR IGNORE INTO notification_reads (user_id, notification_id, read_at) VALUES (?, ?, ?)'
    );
    const now = nowIso();
    for (const row of rows) insert.run(uid, row.id, now);
    res.json({ data: { ok: true, count: rows.length } });
  })
);
