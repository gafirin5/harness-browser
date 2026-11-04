import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { UserInfo, UserRole } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { sha256 } from '../../lib/validation.js';

export const COOKIE_NAME = 'dorado_session';
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_MS = 60 * 1000;
const CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRow {
  id: string;
  user_id: number;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip: string | null;
  user_agent: string | null;
  username: string;
  name: string;
  role: UserRole;
  is_active: number;
}

export interface SessionContext {
  id: string;
  userId: number;
  user: UserInfo;
}

function tokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function tokenFromRequest(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  if (cookies?.[COOKIE_NAME]) return cookies[COOKIE_NAME];
  return tokenFromCookieHeader(req.headers.cookie);
}

function toContext(row: SessionRow): SessionContext {
  return {
    id: row.id,
    userId: row.user_id,
    user: {
      id: row.user_id,
      username: row.username,
      name: row.name,
      role: row.role,
      isActive: Boolean(row.is_active)
    }
  };
}

function findValidSession(token: string | null): SessionContext | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.*, u.username, u.name, u.role, u.is_active
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(sha256(token)) as unknown as SessionRow | undefined;
  if (!row || row.revoked_at || !row.is_active) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) return null;
  if (now - new Date(row.last_seen_at).getTime() > SESSION_IDLE_MS) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), row.id);
    return null;
  }
  if (now - new Date(row.last_seen_at).getTime() > SESSION_TOUCH_MS) {
    const stamp = nowIso();
    db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(stamp, row.id);
    row.last_seen_at = stamp;
  }
  return toContext(row);
}

export function createSession(req: Request, res: Response, userId: number): void {
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_MAX_MS).toISOString();
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, sha256(token), createdAt, createdAt, expiresAt, req.ip ?? null, req.get('user-agent') ?? null);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: SESSION_MAX_MS
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'lax', secure: config.cookieSecure });
}

export function getSessionFromRequest(req: Request): SessionContext | null {
  return findValidSession(tokenFromRequest(req));
}

export function getSessionFromCookieHeader(cookieHeader: string | undefined): SessionContext | null {
  return findValidSession(tokenFromCookieHeader(cookieHeader));
}

export function readSession(req: Request): boolean {
  return getSessionFromRequest(req) !== null;
}

export function revokeCurrentSession(req: Request): void {
  const session = getSessionFromRequest(req);
  if (!session) return;
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), session.id);
}

export function revokeOtherSessions(currentSessionId: string): number {
  const result = db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id <> ? AND revoked_at IS NULL')
    .run(nowIso(), currentSessionId);
  return Number(result.changes);
}

export function revokeUserSessions(userId: number): number {
  const result = db
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowIso(), userId);
  return Number(result.changes);
}

export function cleanupAuthSessions(): number {
  const cutoff = new Date(Date.now() - CLEANUP_AGE_MS).toISOString();
  const result = db
    .prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(cutoff, cutoff);
  return Number(result.changes);
}
