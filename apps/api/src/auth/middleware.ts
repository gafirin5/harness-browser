import type { NextFunction, Request, Response } from 'express';
import { COOKIE_NAME } from '@orca/shared';
import { AppError } from '../lib/errors.js';
import { findSession } from './session.js';

export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.');
  }
  const session = await findSession(token);
  if (!session) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Sesi Anda telah berakhir. Silakan masuk kembali.');
  }
  res.locals.user = session.user;
  res.locals.sessionId = session.sessionId;
  next();
});

export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as { role?: string } | undefined;
  if (!user || user.role !== 'ADMIN') {
    next(new AppError(403, 'FORBIDDEN', 'Anda tidak memiliki akses ke aksi ini.'));
    return;
  }
  next();
}

/**
 * Proteksi CSRF sederhana: SameSite=Lax + validasi Origin/Referer.
 * Request tanpa Origin/Referer (mis. curl/test) tetap diizinkan.
 */
export function csrfGuard(allowedOrigins: readonly string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    const referer = req.get('referer');
    let candidate = origin ?? null;
    if (!candidate && referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = null;
      }
    }
    if (!candidate) {
      next();
      return;
    }
    if (!allowedOrigins.includes(candidate)) {
      next(new AppError(403, 'FORBIDDEN', 'Permintaan ditolak karena origin tidak dikenal.'));
      return;
    }
    next();
  };
}

export function getAuthUser(res: Response): { id: number; name: string; email: string } {
  const user = res.locals.user as { id: number; name: string; email: string } | undefined;
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.');
  return user;
}
