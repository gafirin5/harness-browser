import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { config } from '../../config.js';
import { safeEqual } from '../../lib/validation.js';

export const COOKIE_NAME = 'dorado_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

interface SessionPayload {
  sub: 'admin';
  exp: number;
}

function sign(value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function createSessionToken(): string {
  const payload: SessionPayload = { sub: 'admin', exp: Date.now() + MAX_AGE_SECONDS * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [body, signature] = token.split('.');
  if (!body || !signature) return false;
  if (!safeEqual(signature, sign(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    return payload.sub === 'admin' && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function setSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: MAX_AGE_SECONDS * 1000
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'lax', secure: config.cookieSecure });
}

export function readSession(req: Request): boolean {
  const cookies = req.cookies as Record<string, string> | undefined;
  return verifySessionToken(cookies?.[COOKIE_NAME]);
}

export function readSessionFromCookieHeader(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE_NAME) return verifySessionToken(decodeURIComponent(rest.join('=')));
  }
  return false;
}