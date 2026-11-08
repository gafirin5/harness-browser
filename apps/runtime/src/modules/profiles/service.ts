import { db, newId, nowIso } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';
import { decryptSecret, encryptSecret } from '../../lib/secret.js';

interface ProfileRow {
  id: string;
  name: string;
  agent_id: string;
  env_encrypted: string;
  is_active: number;
  rate_limited_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileInfo {
  id: string;
  name: string;
  agentId: string;
  isActive: boolean;
  envKeys: string[];
  rateLimitedUntil: string | null;
  updatedAt: string;
}

export interface ProfileInput {
  name: string;
  agentId: string;
  env: Record<string, string>;
  isActive?: boolean;
}

function decryptEnv(row: ProfileRow): Record<string, string> {
  try {
    const parsed = JSON.parse(decryptSecret(row.env_encrypted)) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mapProfile(row: ProfileRow): ProfileInfo {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    isActive: Boolean(row.is_active),
    envKeys: Object.keys(decryptEnv(row)),
    rateLimitedUntil: row.rate_limited_until,
    updatedAt: row.updated_at
  };
}

export function listProfiles(): ProfileInfo[] {
  const rows = db.prepare('SELECT * FROM agent_profiles ORDER BY lower(name) ASC').all() as unknown as ProfileRow[];
  return rows.map(mapProfile);
}

function getRow(id: string): ProfileRow | null {
  return (db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as unknown as ProfileRow | undefined) ?? null;
}

export function createProfile(input: ProfileInput): ProfileInfo {
  const id = newId();
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO agent_profiles (id, name, agent_id, env_encrypted, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.name, input.agentId, encryptSecret(JSON.stringify(input.env)), input.isActive ? 1 : 0, stamp, stamp);
  if (input.isActive) setActiveProfile(id);
  return mapProfile(getRow(id) as ProfileRow);
}

export function updateProfile(
  id: string,
  input: Partial<ProfileInput> & { env?: Record<string, string> }
): ProfileInfo {
  const row = getRow(id);
  if (!row) throw notFound('Profile tidak ditemukan.');
  db.prepare(
    `UPDATE agent_profiles SET name = ?, agent_id = ?, env_encrypted = ?, is_active = ?, updated_at = ? WHERE id = ?`
  ).run(
    input.name ?? row.name,
    input.agentId ?? row.agent_id,
    input.env ? encryptSecret(JSON.stringify(input.env)) : row.env_encrypted,
    input.isActive === undefined ? row.is_active : input.isActive ? 1 : 0,
    nowIso(),
    id
  );
  if (input.isActive) setActiveProfile(id);
  return mapProfile(getRow(id) as ProfileRow);
}

export function deleteProfile(id: string): boolean {
  const result = db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

/** Aktifkan satu profil per agent (yang lain otomatis nonaktif). */
export function setActiveProfile(id: string): void {
  const row = getRow(id);
  if (!row) throw notFound('Profile tidak ditemukan.');
  db.prepare('UPDATE agent_profiles SET is_active = 0 WHERE agent_id = ?').run(row.agent_id);
  db.prepare('UPDATE agent_profiles SET is_active = 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
}

/** Env dari profil aktif untuk sebuah agent (atau null bila tidak ada). */
export function getActiveProfileEnv(agentId: string): Record<string, string> | null {
  const row = db
    .prepare('SELECT * FROM agent_profiles WHERE agent_id = ? AND is_active = 1 LIMIT 1')
    .get(agentId) as unknown as ProfileRow | undefined;
  return row ? decryptEnv(row) : null;
}

/** Tandai profil aktif agent sebagai cooldown (mis. setelah kena rate limit). */
export function markRateLimited(agentId: string, cooldownMs = 5 * 60 * 1000): void {
  const until = new Date(Date.now() + cooldownMs).toISOString();
  db.prepare(
    'UPDATE agent_profiles SET rate_limited_until = ?, updated_at = ? WHERE agent_id = ? AND is_active = 1'
  ).run(until, nowIso(), agentId);
}
