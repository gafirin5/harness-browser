import type { User } from '@orca/shared';
import { SESSION_IDLE_MS, SESSION_MAX_MS, SESSION_TOUCH_MS } from '@orca/shared';
import { query, queryOne } from '../db/pool.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { toIso } from '../lib/format.js';

interface SessionRow {
  session_id: string;
  token_hash: string;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  user_id: number;
  email: string;
  name: string;
  role: 'ADMIN';
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

export interface SessionContext {
  sessionId: string;
  user: User;
}

export async function createSession(
  userId: number,
  ip: string | null,
  userAgent: string | null
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const id = randomToken(16);
  const expiresAt = new Date(Date.now() + SESSION_MAX_MS);
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, sha256(token), expiresAt, ip, userAgent]
  );
  return { token, expiresAt };
}

export async function findSession(token: string): Promise<SessionContext | null> {
  const row = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, s.token_hash, s.last_seen_at, s.expires_at, s.revoked_at,
            u.id AS user_id, u.email, u.name, u.role, u.is_active, u.last_login_at, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [sha256(token)]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at.getTime() <= Date.now()) return null;
  if (Date.now() - row.last_seen_at.getTime() > SESSION_IDLE_MS) {
    await revokeSession(row.session_id);
    return null;
  }
  if (!row.is_active) return null;

  if (Date.now() - row.last_seen_at.getTime() > SESSION_TOUCH_MS) {
    await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
  }

  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.is_active,
      lastLoginAt: toIso(row.last_login_at),
      createdAt: toIso(row.created_at) ?? new Date().toISOString()
    }
  };
}

/** Validasi sesi tanpa memperbarui last_seen (dipakai koneksi SSE). */
export async function isSessionValid(token: string): Promise<boolean> {
  const row = await queryOne<{ last_seen_at: Date; expires_at: Date; revoked_at: Date | null; is_active: boolean }>(
    `SELECT s.last_seen_at, s.expires_at, s.revoked_at, u.is_active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [sha256(token)]
  );
  if (!row || row.revoked_at || !row.is_active) return false;
  if (row.expires_at.getTime() <= Date.now()) return false;
  return Date.now() - row.last_seen_at.getTime() <= SESSION_IDLE_MS;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
}

export async function revokeOtherSessions(userId: number, currentSessionId: string): Promise<void> {
  await query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
    [userId, currentSessionId]
  );
}

export async function cleanupSessions(): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM sessions
     WHERE expires_at < now() - interval '7 days'
        OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
     RETURNING id`
  );
  return rows.length;
}
