import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from '../auth/middleware.js';
import { createProfile, deleteProfile, listProfiles, setActiveProfile, updateProfile } from './service.js';

const envSchema = z.record(z.string().max(4000)).default({});

const createSchema = z.object({
  name: z.string().trim().min(1, 'Nama profil wajib diisi.').max(80),
  agentId: z.string().trim().min(1).max(60),
  env: envSchema,
  isActive: z.boolean().default(false)
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    agentId: z.string().trim().min(1).max(60).optional(),
    env: envSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const profilesRouter = Router();
profilesRouter.use(csrfGuard, requireAuth);

profilesRouter.get('/', (_req, res) => {
  res.json({ data: listProfiles() });
});

profilesRouter.post('/', requireAdmin, (req, res) => {
  const body = parseWith(createSchema, req.body);
  res.status(201).json({ data: createProfile(body) });
});

profilesRouter.patch('/:id', requireAdmin, (req, res) => {
  const body = parseWith(updateSchema, req.body);
  const id = String(req.params.id ?? '');
  if (!listProfiles().some((profile) => profile.id === id)) throw notFound('Profile tidak ditemukan.');
  res.json({ data: updateProfile(id, body) });
});

profilesRouter.post('/:id/activate', requireAdmin, (req, res) => {
  setActiveProfile(String(req.params.id ?? ''));
  res.json({ data: listProfiles() });
});

profilesRouter.delete('/:id', requireAdmin, (req, res) => {
  if (!deleteProfile(String(req.params.id ?? ''))) throw notFound('Profile tidak ditemukan.');
  res.status(204).end();
});
