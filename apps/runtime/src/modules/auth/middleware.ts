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

function firstHeaderValue(value: string | undefined): string | undefined {
  return value?.split(',')[0]?.trim() || undefined;
}

interface OriginContext {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
  get?: (name: string) => string | undefined;
}

function readHeader(req: OriginContext, name: string): string | undefined {
  const fromGet = req.get?.(name);
  if (fromGet) return fromGet;
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Origin dari request itu sendiri (Host + proto), menghormati X-Forwarded-Proto
 * dari reverse proxy (Nginx/cloudflared). Dipakai agar pemeriksaan CSRF menerima
 * same-origin apa pun (tunnel/domain/IP) tanpa mengubah daftar allowedOrigins.
 */
export function requestOrigin(req: OriginContext): string | null {
  const host = firstHeaderValue(readHeader(req, 'host'));
  if (!host) return null;
  const proto = firstHeaderValue(readHeader(req, 'x-forwarded-proto')) ?? req.protocol ?? 'http';
  return `${proto}://${host}`;
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
  const selfOrigin = requestOrigin(req);
  if (candidate && !config.allowedOrigins.includes(candidate) && candidate !== selfOrigin) {
    next(new AppError(403, 'FORBIDDEN', 'Origin tidak diizinkan.'));
    return;
  }
  next();
}

export function checkWsOrigin(origin: string | undefined, req: OriginContext): boolean {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  const selfOrigin = requestOrigin(req);
  return Boolean(selfOrigin && origin === selfOrigin);
}

export function clearRateLimits(): void {
  buckets.clear();
}
