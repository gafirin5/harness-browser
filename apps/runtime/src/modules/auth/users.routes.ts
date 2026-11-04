import { Router } from 'express';
import { userCreateSchema, userResetPasswordSchema, userUpdateSchema } from '@dorado/shared';
import { AppError } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAdmin, requireAuth } from './middleware.js';
import { revokeUserSessions } from './session.js';
import { createUser, listUsers, resetUserPassword, updateUser } from './users.js';

export const usersRouter = Router();
usersRouter.use(csrfGuard, requireAuth, requireAdmin);

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(422, 'VALIDATION_ERROR', 'ID tidak valid.');
  return id;
}

usersRouter.get('/', (_req, res) => {
  res.json({ data: listUsers() });
});

usersRouter.post('/', (req, res) => {
  const body = parseWith(userCreateSchema, req.body);
  const user = createUser(body);
  res.status(201).json({ data: user, message: 'User berhasil dibuat.' });
});

usersRouter.patch('/:id', (req, res) => {
  const body = parseWith(userUpdateSchema, req.body);
  const user = updateUser(parseId(req.params.id ?? ''), body);
  if (body.isActive === false) revokeUserSessions(user.id);
  res.json({ data: user, message: 'User berhasil diperbarui.' });
});

usersRouter.post('/:id/reset-password', (req, res) => {
  const id = parseId(req.params.id ?? '');
  const body = parseWith(userResetPasswordSchema, req.body);
  resetUserPassword(id, body.newPassword);
  const revoked = revokeUserSessions(id);
  res.json({ data: { revoked }, message: 'Password user berhasil direset.' });
});
