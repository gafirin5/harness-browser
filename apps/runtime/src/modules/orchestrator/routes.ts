import { Router } from 'express';
import {
  orchAgentCreateSchema,
  orchAgentResultSchema,
  orchAgentUpdateSchema,
  orchCancelTaskSchema,
  orchIdempotencyKeySchema,
  orchListQuerySchema,
  orchLogQuerySchema,
  orchProviderCreateSchema,
  orchProviderUpdateSchema,
  orchTaskCreateSchema,
  orchTaskListQuerySchema
} from '@dorado/shared';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, rateLimit, requireAuth } from '../auth/middleware.js';
import { getDashboardSummary } from './dashboard.js';
import { addClient, broadcastSummaryNow, sendHeartbeat } from './hub.js';
import {
  applyAgentResult,
  cancelTask,
  createAgent,
  createProvider,
  createTask,
  findAgentByToken,
  getAgent,
  getProvider,
  getTaskLogs,
  getTaskOrThrow,
  listAgents,
  listProviders,
  listTasks,
  retryTask,
  rotateAgentToken,
  updateAgent,
  updateProvider
} from './service.js';

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(422, 'VALIDATION_ERROR', 'ID tidak valid.');
  return id;
}

function meta(
  page: number,
  pageSize: number,
  total: number
): {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function idempotencyKey(req: Parameters<typeof requireAuth>[0]): string | null {
  const header = req.get('Idempotency-Key');
  if (!header) return null;
  return parseWith(orchIdempotencyKeySchema, header);
}

export const orchestratorRouter = Router();
orchestratorRouter.use(csrfGuard, requireAuth);
orchestratorRouter.use((req, _res, next) => {
  try {
    rateLimit(`orchestrator:${req.ip ?? 'unknown'}`, 300, 60_000);
    next();
  } catch (error) {
    next(error);
  }
});

orchestratorRouter.get('/summary', (_req, res) => {
  res.json({ data: getDashboardSummary() });
});

orchestratorRouter.get('/providers', (req, res) => {
  const query = parseWith(orchListQuerySchema, req.query);
  const result = listProviders(query.q, query.page, query.pageSize);
  res.json({ data: result.data, meta: meta(query.page, query.pageSize, result.total) });
});

orchestratorRouter.post('/providers', (req, res) => {
  const body = parseWith(orchProviderCreateSchema, req.body);
  const provider = createProvider(body);
  broadcastSummaryNow();
  res.status(201).json({ data: provider, message: 'Provider berhasil disimpan.' });
});

orchestratorRouter.get('/providers/:id', (req, res) => {
  const provider = getProvider(parseId(req.params.id ?? ''));
  if (!provider) throw new AppError(404, 'NOT_FOUND', 'Provider tidak ditemukan.');
  res.json({ data: provider });
});

orchestratorRouter.patch('/providers/:id', (req, res) => {
  const body = parseWith(orchProviderUpdateSchema, req.body);
  const provider = updateProvider(parseId(req.params.id ?? ''), body);
  broadcastSummaryNow();
  res.json({ data: provider, message: 'Provider berhasil diperbarui.' });
});

orchestratorRouter.get('/agents', (req, res) => {
  const query = parseWith(orchListQuerySchema, req.query);
  const result = listAgents(query.q, query.page, query.pageSize);
  res.json({ data: result.data, meta: meta(query.page, query.pageSize, result.total) });
});

orchestratorRouter.post('/agents', (req, res) => {
  const body = parseWith(orchAgentCreateSchema, req.body);
  const result = createAgent(body);
  broadcastSummaryNow();
  res.status(201).json({
    data: result.agent,
    agentToken: result.token,
    message: 'Agent berhasil didaftarkan.'
  });
});

orchestratorRouter.get('/agents/:id', (req, res) => {
  const agent = getAgent(parseId(req.params.id ?? ''));
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent tidak ditemukan.');
  res.json({ data: agent });
});

orchestratorRouter.patch('/agents/:id', (req, res) => {
  const body = parseWith(orchAgentUpdateSchema, req.body);
  const agent = updateAgent(parseId(req.params.id ?? ''), body);
  broadcastSummaryNow();
  res.json({ data: agent, message: 'Agent berhasil diperbarui.' });
});

orchestratorRouter.post('/agents/:id/rotate-token', (req, res) => {
  const token = rotateAgentToken(parseId(req.params.id ?? ''));
  res.json({ agentToken: token, message: 'Token agent berhasil diperbarui. Simpan token ini sekarang.' });
});

orchestratorRouter.get('/tasks', (req, res) => {
  const query = parseWith(orchTaskListQuerySchema, req.query);
  const result = listTasks(query);
  res.json({ data: result.data, meta: meta(query.page, query.pageSize, result.total) });
});

orchestratorRouter.post('/tasks', (req, res) => {
  const body = parseWith(orchTaskCreateSchema, req.body);
  const result = createTask(body, idempotencyKey(req));
  res.status(201).json({
    data: result.task,
    idempotent: !result.created,
    message: 'Task berhasil masuk antrean.'
  });
});

orchestratorRouter.get('/tasks/:id', (req, res) => {
  res.json({ data: getTaskOrThrow(parseId(req.params.id ?? '')) });
});

orchestratorRouter.get('/tasks/:id/logs', (req, res) => {
  const id = parseId(req.params.id ?? '');
  getTaskOrThrow(id);
  const query = parseWith(orchLogQuerySchema, req.query);
  res.json({ data: getTaskLogs(id, query.afterId, query.limit) });
});

orchestratorRouter.post('/tasks/:id/cancel', (req, res) => {
  const body = parseWith(orchCancelTaskSchema, req.body);
  const result = cancelTask(parseId(req.params.id ?? ''), body.reason);
  res.json({ data: result.task, message: 'Task berhasil dibatalkan.' });
});

orchestratorRouter.post('/tasks/:id/retry', (req, res) => {
  const task = retryTask(parseId(req.params.id ?? ''), idempotencyKey(req));
  res.status(201).json({ data: task, message: 'Task baru berhasil masuk antrean.' });
});

orchestratorRouter.get('/events', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');

  const remove = addClient(res);
  res.write(`event: summary\ndata: ${JSON.stringify(getDashboardSummary())}\n\n`);

  const heartbeat = setInterval(() => sendHeartbeat(), 15_000);
  heartbeat.unref();

  req.on('close', () => {
    clearInterval(heartbeat);
    remove();
    res.end();
  });
  req.on('error', () => {
    clearInterval(heartbeat);
    remove();
  });
});

/* ---------- callback worker agent (bearer token, bukan cookie) ---------- */

export const orchestratorAgentRouter = Router();

orchestratorAgentRouter.post(
  '/tasks/:code/result',
  asyncHandler(async (req, res) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) throw new AppError(401, 'UNAUTHORIZED', 'Token agent wajib dikirim.');
    const agent = findAgentByToken(match[1]);
    if (!agent) throw new AppError(401, 'UNAUTHORIZED', 'Token agent tidak valid.');

    rateLimit(`orchestrator-callback:${agent.id}`, 120, 60_000);
    const body = parseWith(orchAgentResultSchema, req.body);
    const result = applyAgentResult(agent.id, String(req.params.code ?? ''), body);
    res.json({ data: result });
  })
);
