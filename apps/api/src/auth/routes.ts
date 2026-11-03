import { Router } from 'express';
import type { User } from '@orca/shared';
import { COOKIE_NAME, SESSION_MAX_MS, changePasswordSchema, loginSchema } from '@orca/shared';
import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { toIso } from '../lib/format.js';
import { parseWith } from '../lib/validate.js';
import { rateLimit, resetRateLimit } from '../lib/rate-limit.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password.js';
import { asyncHandler, getAuthUser, requireAuth } from './middleware.js';
import { createSession, findSession, revokeOtherSessions, revokeSession } from './session.js';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: 'ADMIN';
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.cookieSecure,
  path: '/',
  maxAge: SESSION_MAX_MS
};

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parseWith(loginSchema, req.body);
    const ip = req.ip ?? 'unknown';
    rateLimit(`login:ip:${ip}`, 20, 60_000);
    rateLimit(`login:email:${body.email.toLowerCase()}`, 10, 60_000);

    const user = await queryOne<UserRow>(
      `SELECT id, email, password_hash, name, role, is_active, failed_login_attempts, locked_until, last_login_at, created_at
       FROM users WHERE lower(email) = lower($1)`,
      [body.email]
    );

    if (!user) {
      await burnPasswordCheck(body.password);
      throw new AppError(401, 'UNAUTHORIZED', 'Email atau password salah.');
    }

    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Akun dikunci sementara selama 15 menit karena terlalu banyak percobaan gagal.');
    }

    if (!user.is_active) {
      throw new AppError(403, 'FORBIDDEN', 'Akun ini sedang dinonaktifkan.');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      const rows = await query<{ failed_login_attempts: number; locked_until: Date | null }>(
        `UPDATE users
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
             updated_at = now()
         WHERE id = $1
         RETURNING failed_login_attempts, locked_until`,
        [user.id]
      );
      const updated = rows[0];
      if (updated && updated.failed_login_attempts >= 5) {
        throw new AppError(423, 'ACCOUNT_LOCKED', 'Akun dikunci sementara selama 15 menit karena terlalu banyak percobaan gagal.');
      }
      throw new AppError(401, 'UNAUTHORIZED', 'Email atau password salah.');
    }

    await query(
      `UPDATE users
       SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
       WHERE id = $1`,
      [user.id]
    );

    const session = await createSession(user.id, ip, req.get('user-agent') ?? null);
    res.cookie(COOKIE_NAME, session.token, cookieOptions);
    resetRateLimit(`login:email:${body.email.toLowerCase()}`);
    res.json({ data: { user: mapUser({ ...user, last_login_at: new Date() }) } });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
    if (token) {
      const session = await findSession(token);
      if (session) await revokeSession(session.sessionId);
    }
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ data: { user: getAuthUser(res) } });
  })
);

authRouter.patch(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseWith(changePasswordSchema, req.body);
    const userId = getAuthUser(res).id;
    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!row) throw new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.');

    const valid = await verifyPassword(body.current_password, row.password_hash);
    if (!valid) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Password saat ini salah.', {
        current_password: 'Password saat ini salah.'
      });
    }

    const newHash = await hashPassword(body.new_password);
    await query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = now(), failed_login_attempts = 0,
           locked_until = NULL, updated_at = now()
       WHERE id = $2`,
      [newHash, userId]
    );
    await revokeOtherSessions(userId, res.locals.sessionId as string);
    res.json({ data: { message: 'Password berhasil diperbarui.' } });
  })
);
