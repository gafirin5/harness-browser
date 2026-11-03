import crypto from 'node:crypto';
import { Router } from 'express';
import { loginSchema, pairSchema, pairingTokenCreateSchema } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/errors.js';
import { parseWith, safeEqual, sha256 } from '../../lib/validation.js';
import { csrfGuard, rateLimit, requireAuth } from './middleware.js';
import { clearSessionCookie, setSessionCookie } from './session.js';

export const authRouter = Router();
authRouter.use(csrfGuard);

const adminFingerprint = crypto.createHash('sha256').update(config.adminPassword).digest('hex');

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    rateLimit(`login:${req.ip ?? 'unknown'}`, 15, 60_000);
    const body = parseWith(loginSchema, req.body);
    const supplied = crypto.createHash('sha256').update(body.password).digest('hex');
    if (!safeEqual(supplied, adminFingerprint)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Password salah.');
    }
    setSessionCookie(res);
    res.json({ data: { user: { id: 1, name: 'Admin' } } });
  })
);

authRouter.post(
  '/pair',
  asyncHandler(async (req, res) => {
    rateLimit(`pair:${req.ip ?? 'unknown'}`, 15, 60_000);
    const body = parseWith(pairSchema, req.body);
    const hash = sha256(body.token);
    const row = db
      .prepare('SELECT id, expires_at, revoked_at FROM pairing_tokens WHERE token_hash = ?')
      .get(hash) as { id: string; expires_at: string; revoked_at: string | null } | undefined;
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      throw new AppError(401, 'UNAUTHORIZED', 'Token pairing tidak valid atau sudah kedaluwarsa.');
    }
    db.prepare('UPDATE pairing_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
    setSessionCookie(res);
    res.json({ data: { user: { id: 1, name: 'Admin' } } });
  })
);

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (_req, res) => {
  res.json({ data: { user: { id: 1, name: 'Admin' } } });
});

export const pairingRouter = Router();
pairingRouter.use(csrfGuard, requireAuth);

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
  db.prepare(
    'INSERT INTO pairing_tokens (id, token_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, sha256(token), body.label, createdAt, expiresAt);
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
  res.status(204).end();
});