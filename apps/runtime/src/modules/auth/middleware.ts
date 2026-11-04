import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { readSession } from './session.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!readSession(req)) {
    next(new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.'));
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
