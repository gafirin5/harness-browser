import type { NextFunction, Request, Response } from 'express';
import type { UserInfo } from '@dorado/shared';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { getSessionFromRequest } from './session.js';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.user) {
    next();
    return;
  }
  const session = getSessionFromRequest(req);
  if (!session) {
    next(new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.'));
    return;
  }
  res.locals.user = session.user;
  res.locals.sessionId = session.id;
  next();
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as UserInfo | undefined;
  if (!user || user.role !== 'ADMIN') {
    next(new AppError(403, 'FORBIDDEN', 'Hanya admin yang dapat melakukan tindakan ini.'));
    return;
  }
  next();
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) throw new AppError(429, 'RATE_LIMITED', 'Terlalu banyak percobaan. Coba lagi nanti.');
}

export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  if (req.get('x-dorado-trusted-user')) {
    next();
    return;
  }
  const origin = req.get('origin');
  let candidate = origin ?? null;
  if (!candidate) {
    const referer = req.get('referer');
    if (referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = null;
      }
    }
  }
  if (candidate && !config.allowedOrigins.includes(candidate)) {
    next(new AppError(403, 'FORBIDDEN', 'Origin tidak diizinkan.'));
    return;
  }
  next();
}

export function checkWsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}

export function clearRateLimits(): void {
  buckets.clear();
}
