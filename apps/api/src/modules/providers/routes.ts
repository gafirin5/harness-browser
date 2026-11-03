import { Router } from 'express';
import { providerCreateSchema, providerListQuerySchema, providerUpdateSchema } from '@orca/shared';
import { getAuthUser, requireAuth } from '../../auth/middleware.js';
import { parseId, parseWith } from '../../lib/validate.js';
import { createProvider, getProvider, listProviders, updateProvider } from './service.js';
import { AppError } from '../../lib/errors.js';
import { scheduleSummaryBroadcast } from '../../realtime/hub.js';

export const providersRouter = Router();

providersRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const query = parseWith(providerListQuerySchema, req.query);
    const result = await listProviders(query.q, query.page, query.page_size);
    const totalPages = Math.max(1, Math.ceil(result.total / query.page_size));
    res.json({
      data: result.data,
      meta: { page: query.page, pageSize: query.page_size, total: result.total, totalPages }
    });
  } catch (error) {
    next(error);
  }
});

providersRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = parseWith(providerCreateSchema, req.body);
    const provider = await createProvider(getAuthUser(res).id, body);
    scheduleSummaryBroadcast();
    res.status(201).json({ data: provider, message: 'Provider berhasil disimpan.' });
  } catch (error) {
    next(error);
  }
});

providersRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id ?? '');
    const body = parseWith(providerUpdateSchema, req.body);
    const provider = await updateProvider(id, body);
    scheduleSummaryBroadcast();
    res.json({ data: provider, message: 'Provider berhasil diperbarui.' });
  } catch (error) {
    next(error);
  }
});

providersRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.id ?? '');
    const provider = await getProvider(id);
    if (!provider) throw new AppError(404, 'NOT_FOUND', 'Provider tidak ditemukan.');
    res.json({ data: provider });
  } catch (error) {
    next(error);
  }
});
