import { Router } from 'express';
import { agentCreateSchema, agentListQuerySchema, agentUpdateSchema } from '@orca/shared';
import { getAuthUser, requireAuth } from '../../auth/middleware.js';
import { AppError } from '../../lib/errors.js';
import { parseId, parseWith } from '../../lib/validate.js';
import { scheduleSummaryBroadcast } from '../../realtime/hub.js';
import { createAgent, getAgent, listAgents, rotateAgentToken, updateAgent } from './service.js';

export const agentsRouter = Router();

agentsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const query = parseWith(agentListQuerySchema, req.query);
    const result = await listAgents(query.q, query.page, query.page_size);
    const totalPages = Math.max(1, Math.ceil(result.total / query.page_size));
    res.json({
      data: result.data,
      meta: { page: query.page, pageSize: query.page_size, total: result.total, totalPages }
    });
  } catch (error) {
    next(error);
  }
});

agentsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = parseWith(agentCreateSchema, req.body);
    const result = await createAgent(getAuthUser(res).id, body);
    scheduleSummaryBroadcast();
    res.status(201).json({
      data: result.agent,
      agentToken: result.token,
      message: 'Agent berhasil didaftarkan.'
    });
  } catch (error) {
    next(error);
  }
});

agentsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const agent = await getAgent(parseId(req.params.id ?? ''));
    if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent tidak ditemukan.');
    res.json({ data: agent });
  } catch (error) {
    next(error);
  }
});

agentsRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const body = parseWith(agentUpdateSchema, req.body);
    const agent = await updateAgent(parseId(req.params.id ?? ''), body);
    scheduleSummaryBroadcast();
    res.json({ data: agent, message: 'Agent berhasil diperbarui.' });
  } catch (error) {
    next(error);
  }
});

agentsRouter.post('/:id/rotate-token', requireAuth, async (req, res, next) => {
  try {
    const token = await rotateAgentToken(parseId(req.params.id ?? ''));
    res.json({ agentToken: token, message: 'Token agent berhasil diperbarui. Simpan token ini sekarang.' });
  } catch (error) {
    next(error);
  }
});
