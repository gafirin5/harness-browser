import { Router } from 'express';
import { z } from 'zod';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { listAuditLogs } from './service.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional()
});

export const auditRouter = Router();
auditRouter.use(csrfGuard, requireAuth, requireAdmin);

auditRouter.get('/', (req, res) => {
  const query = parseWith(querySchema, req.query);
  const result = listAuditLogs({
    limit: query.limit,
    offset: query.offset,
    action: query.action,
    q: query.q
  });
  res.json({
    data: result.data,
    meta: { limit: query.limit, offset: query.offset, total: result.total }
  });
});
