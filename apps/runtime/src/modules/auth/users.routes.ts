import { Router } from 'express';
import { userCreateSchema, userResetPasswordSchema, userUpdateSchema } from '@dorado/shared';
import { AppError } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { recordAudit } from '../audit/service.js';
import { csrfGuard, requireAdmin, requireAuth } from './middleware.js';
import { revokeUserSessions } from './session.js';
import { createUser, disableTotp, listUsers, resetUserPassword, updateUser } from './users.js';

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
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'USER_CREATE',
      targetType: 'user',
      targetId: user.id,
      detail: `${user.username} (${user.role})`,
      ip: req.ip ?? null
    });
  }
  res.status(201).json({ data: user, message: 'User berhasil dibuat.' });
});

usersRouter.patch('/:id', (req, res) => {
  const body = parseWith(userUpdateSchema, req.body);
  const user = updateUser(parseId(req.params.id ?? ''), body);
  if (body.isActive === false) revokeUserSessions(user.id);
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'USER_UPDATE',
      targetType: 'user',
      targetId: user.id,
      detail: JSON.stringify(body),
      ip: req.ip ?? null
    });
  }
  res.json({ data: user, message: 'User berhasil diperbarui.' });
});

usersRouter.post('/:id/reset-password', (req, res) => {
  const id = parseId(req.params.id ?? '');
  const body = parseWith(userResetPasswordSchema, req.body);
  resetUserPassword(id, body.newPassword);
  const revoked = revokeUserSessions(id);
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'USER_PASSWORD_RESET',
      targetType: 'user',
      targetId: id,
      detail: `${revoked} sesi dicabut.`,
      ip: req.ip ?? null
    });
  }
  res.json({ data: { revoked }, message: 'Password user berhasil direset.' });
});

usersRouter.post('/:id/2fa-disable', (req, res) => {
  const id = parseId(req.params.id ?? '');
  disableTotp(id);
  revokeUserSessions(id);
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'USER_2FA_RESET',
      targetType: 'user',
      targetId: id,
      ip: req.ip ?? null
    });
  }
  res.json({ data: { enabled: false }, message: '2FA user berhasil dinonaktifkan.' });
});
