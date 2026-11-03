import { Router } from 'express';
import { z } from 'zod';
import { cancelTaskSchema, logQuerySchema, taskCreateSchema, taskListQuerySchema } from '@orca/shared';
import { getAuthUser, requireAuth } from '../../auth/middleware.js';
import { parseId, parseWith } from '../../lib/validate.js';
import { AppError } from '../../lib/errors.js';
import { cancelTask, createTask, getTaskOrThrow, getTaskLogs, listTasks, retryTask } from './service.js';

const idempotencyKeySchema = z.string().uuid('Idempotency-Key harus berupa UUID.');

export const tasksRouter = Router();

tasksRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const filters = parseWith(taskListQuerySchema, req.query);
    const result = await listTasks(filters);
    const totalPages = Math.max(1, Math.ceil(result.total / filters.page_size));
    res.json({
      data: result.data,
      meta: {
        page: filters.page,
        pageSize: filters.page_size,
        total: result.total,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = parseWith(taskCreateSchema, req.body);
    const headerKey = req.get('Idempotency-Key');
    const clientRequestId = headerKey ? parseWith(idempotencyKeySchema, headerKey) : null;
    const result = await createTask(getAuthUser(res).id, body, clientRequestId);
    res.status(201).json({
      data: result.task,
      idempotent: !result.created,
      message: 'Task berhasil masuk antrean.'
    });
  } catch (error) {
    next(error);
  }
});

tasksRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const task = await getTaskOrThrow(parseId(req.params.id ?? ''));
    res.json({ data: task });
  } catch (error) {
    next(error);
  }
});

tasksRouter.get('/:id/logs', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id ?? '');
    await getTaskOrThrow(id);
    const query = parseWith(logQuerySchema, req.query);
    const logs = await getTaskLogs(id, query.after_id, query.limit);
    res.json({ data: logs });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id ?? '');
    const body = parseWith(cancelTaskSchema, req.body);
    const result = await cancelTask(id, getAuthUser(res).id, body.reason);
    res.json({ data: result.task, message: 'Task berhasil dibatalkan.' });
  } catch (error) {
    next(error);
  }
});

tasksRouter.post('/:id/retry', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id ?? '');
    const task = await retryTask(id, getAuthUser(res).id);
    res.status(201).json({ data: task, message: 'Task baru berhasil masuk antrean.' });
  } catch (error) {
    next(error);
  }
});

tasksRouter.use((_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Endpoint task tidak ditemukan.'));
});
