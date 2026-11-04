import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  pairSchema,
  pairingTokenCreateSchema,
  totpConfirmSchema,
  totpDisableSchema
} from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/errors.js';
import { generateTotpSetup } from '../../lib/totp.js';
import { parseWith, sha256 } from '../../lib/validation.js';
import { recordAudit } from '../audit/service.js';
import { csrfGuard, rateLimit, requireAdmin, requireAuth } from './middleware.js';
import {
  clearSessionCookie,
  createSession,
  getSessionFromRequest,
  revokeCurrentSession,
  revokeOtherSessions
} from './session.js';
import {
  confirmTotp,
  disableTotp,
  ensureAdminUser,
  getUserAuthByUsername,
  getUserById,
  mapUser,
  storeTotpSetup,
  updateUserPassword,
  verifyUserPassword,
  verifyUserTotp
} from './users.js';

export const authRouter = Router();
authRouter.use(csrfGuard);
ensureAdminUser();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    rateLimit(`login:${req.ip ?? 'unknown'}`, 15, 60_000);
    const body = parseWith(loginSchema, req.body);
    const record = getUserAuthByUsername(body.username);
    if (!record || !record.is_active || !bcrypt.compareSync(body.password, record.password_hash)) {
      recordAudit({
        username: body.username,
        action: 'LOGIN_FAILED',
        detail: 'Username atau password salah.',
        ip: req.ip ?? null
      });
      throw new AppError(401, 'UNAUTHORIZED', 'Username atau password salah.');
    }
    if (record.totp_enabled) {
      if (!body.totpCode) {
        recordAudit({
          userId: record.id,
          username: record.username,
          action: 'LOGIN_FAILED',
          detail: 'Kode 2FA wajib diisi.',
          ip: req.ip ?? null
        });
        throw new AppError(401, 'TOTP_REQUIRED', 'Kode 2FA wajib diisi.', {
          totpCode: 'Kode 2FA wajib diisi.'
        });
      }
      if (!verifyUserTotp(record.id, body.totpCode)) {
        recordAudit({
          userId: record.id,
          username: record.username,
          action: 'LOGIN_FAILED',
          detail: 'Kode 2FA salah atau kedaluwarsa.',
          ip: req.ip ?? null
        });
        throw new AppError(401, 'INVALID_TOTP', 'Kode 2FA salah atau kedaluwarsa.', {
          totpCode: 'Kode 2FA salah atau kedaluwarsa.'
        });
      }
    }
    recordAudit({
      userId: record.id,
      username: record.username,
      action: 'LOGIN',
      detail: 'Password',
      ip: req.ip ?? null
    });
    createSession(req, res, record.id);
    res.json({ data: { user: mapUser(record) } });
  })
);

authRouter.post(
  '/pair',
  asyncHandler(async (req, res) => {
    rateLimit(`pair:${req.ip ?? 'unknown'}`, 15, 60_000);
    const body = parseWith(pairSchema, req.body);
    const hash = sha256(body.token);
    const row = db.prepare('SELECT id, expires_at, revoked_at FROM pairing_tokens WHERE token_hash = ?').get(hash) as
      | { id: string; expires_at: string; revoked_at: string | null }
      | undefined;
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token pairing tidak valid atau sudah kedaluwarsa.');
    }
    db.prepare('UPDATE pairing_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
    const admin = getUserById(1);
    if (!admin) throw new AppError(500, 'INTERNAL', 'Admin tidak tersedia.');
    recordAudit({
      userId: admin.id,
      username: admin.username,
      action: 'LOGIN',
      detail: 'Pairing token',
      ip: req.ip ?? null
    });
    createSession(req, res, admin.id);
    res.json({ data: { user: admin } });
  })
);

authRouter.post('/logout', (req, res) => {
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'LOGOUT',
      ip: req.ip ?? null
    });
  }
  revokeCurrentSession(req);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (_req, res) => {
  res.json({ data: { user: res.locals.user } });
});

authRouter.post(
  '/2fa/setup',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const current = res.locals.user as { id: number; username: string; totpEnabled: boolean } | undefined;
    if (!current) throw new AppError(401, 'UNAUTHORIZED', 'Sesi tidak valid.');
    if (current.totpEnabled) {
      throw new AppError(409, 'TOTP_ALREADY_ENABLED', '2FA sudah aktif. Nonaktifkan terlebih dahulu.');
    }
    const setup = await generateTotpSetup(current.username);
    storeTotpSetup(current.id, setup.encryptedSecret);
    recordAudit({
      userId: current.id,
      username: current.username,
      action: '2FA_SETUP',
      detail: 'Secret 2FA baru dibuat; menunggu konfirmasi.',
      ip: _req.ip ?? null
    });
    res.json({
      data: { secret: setup.secret, otpauthUrl: setup.otpauthUrl, qrDataUrl: setup.qrDataUrl },
      message: 'Scan QR lalu masukkan kode 6 digit untuk mengaktifkan 2FA.'
    });
  })
);

authRouter.post(
  '/2fa/confirm',
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = res.locals.user as { id: number } | undefined;
    if (!current) throw new AppError(401, 'UNAUTHORIZED', 'Sesi tidak valid.');
    const body = parseWith(totpConfirmSchema, req.body);
    if (!confirmTotp(current.id, body.code)) {
      throw new AppError(401, 'INVALID_TOTP', 'Kode 2FA salah atau kedaluwarsa.', {
        code: 'Kode 2FA salah atau kedaluwarsa.'
      });
    }
    const actor = res.locals.user as { id: number; username: string } | undefined;
    if (actor) {
      recordAudit({
        userId: actor.id,
        username: actor.username,
        action: '2FA_ENABLED',
        ip: req.ip ?? null
      });
    }
    res.json({ data: { enabled: true }, message: '2FA berhasil diaktifkan.' });
  })
);

authRouter.post(
  '/2fa/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const current = res.locals.user as { id: number; username: string; totpEnabled: boolean } | undefined;
    if (!current) throw new AppError(401, 'UNAUTHORIZED', 'Sesi tidak valid.');
    if (!current.totpEnabled) throw new AppError(409, 'TOTP_NOT_ENABLED', '2FA belum aktif.');
    const body = parseWith(totpDisableSchema, req.body);
    if (!verifyUserPassword(current.username, body.password)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Password salah.');
    }
    if (!verifyUserTotp(current.id, body.code)) {
      throw new AppError(401, 'INVALID_TOTP', 'Kode 2FA salah atau kedaluwarsa.', {
        code: 'Kode 2FA salah atau kedaluwarsa.'
      });
    }
    disableTotp(current.id);
    recordAudit({
      userId: current.id,
      username: current.username,
      action: '2FA_DISABLED',
      ip: req.ip ?? null
    });
    res.json({ data: { enabled: false }, message: '2FA dinonaktifkan.' });
  })
);

authRouter.patch(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseWith(changePasswordSchema, req.body);
    const current = res.locals.user as { id: number; username: string } | undefined;
    if (!current || !verifyUserPassword(current.username, body.currentPassword)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Password saat ini salah.');
    }
    updateUserPassword(current.id, body.newPassword);
    const session = getSessionFromRequest(req);
    const revoked = session ? revokeOtherSessions(session.id) : 0;
    recordAudit({
      userId: current.id,
      username: current.username,
      action: 'PASSWORD_CHANGE',
      detail: `${revoked} sesi lain dicabut.`,
      ip: req.ip ?? null
    });
    res.json({ data: { updated: true, revokedSessions: revoked }, message: 'Password berhasil diperbarui.' });
  })
);

authRouter.post('/sessions/revoke-others', requireAuth, (req, res) => {
  const session = getSessionFromRequest(req);
  if (!session) throw new AppError(401, 'UNAUTHORIZED', 'Sesi tidak valid.');
  const revoked = revokeOtherSessions(session.id);
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'SESSION_REVOKE_OTHERS',
      detail: `${revoked} sesi dicabut.`,
      ip: req.ip ?? null
    });
  }
  res.json({ data: { revoked }, message: 'Sesi lain berhasil dicabut.' });
});

export const pairingRouter = Router();
pairingRouter.use(csrfGuard, requireAuth, requireAdmin);

pairingRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT id, label, created_at, expires_at, revoked_at FROM pairing_tokens ORDER BY created_at DESC')
    .all() as Array<{ id: string; label: string; created_at: string; expires_at: string; revoked_at: string | null }>;
  res.json({
    data: rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at
    }))
  });
});

pairingRouter.post('/', (req, res) => {
  const body = parseWith(pairingTokenCreateSchema, req.body);
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.pairingTtlMs).toISOString();
  db.prepare('INSERT INTO pairing_tokens (id, token_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    sha256(token),
    body.label,
    createdAt,
    expiresAt
  );
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'PAIRING_CREATE',
      targetType: 'pairing',
      targetId: id,
      detail: body.label,
      ip: req.ip ?? null
    });
  }
  res.status(201).json({
    data: {
      id,
      label: body.label,
      token,
      expiresAt,
      pairUrl: `${config.publicBaseUrl}/?pair=${encodeURIComponent(token)}`
    }
  });
});

pairingRouter.delete('/:id', (req, res) => {
  const result = db
    .prepare('UPDATE pairing_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(nowIso(), req.params.id);
  if (result.changes === 0) throw new AppError(404, 'NOT_FOUND', 'Token tidak ditemukan.');
  const actor = res.locals.user as { id: number; username: string } | undefined;
  if (actor) {
    recordAudit({
      userId: actor.id,
      username: actor.username,
      action: 'PAIRING_REVOKE',
      targetType: 'pairing',
      targetId: req.params.id ?? null,
      ip: req.ip ?? null
    });
  }
  res.status(204).end();
});
