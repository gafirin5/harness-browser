import bcrypt from 'bcryptjs';
import type { UserInfo, UserRole } from '@dorado/shared';
import { config } from '../../config.js';
import { db, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { decryptSecret } from '../../lib/secret.js';
import { currentTotpCounter, verifyTotpCode } from '../../lib/totp.js';

const BCRYPT_COST = 10;

interface UserRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  totp_enabled: number;
  totp_secret_encrypted: string | null;
  totp_last_counter: number | null;
  totp_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCreateInput {
  username: string;
  name: string;
  password: string;
  role: UserRole;
}

export interface UserUpdateInput {
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST);
}

function uniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export function mapUser(row: UserRow): UserInfo {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    isActive: Boolean(row.is_active),
    totpEnabled: Boolean(row.totp_enabled)
  };
}

/**
 * Membuat user admin pertama dari admin_credentials lama (jika ada) atau
 * ADMIN_PASSWORD. Aman dipanggil berulang kali.
 */
export function ensureAdminUser(): void {
  const count = (db.prepare('SELECT count(*) AS total FROM users').get() as { total: number }).total;
  if (count > 0) return;

  const legacy = db.prepare('SELECT password_hash FROM admin_credentials WHERE id = 1').get() as
    | { password_hash: string }
    | undefined;
  const passwordHash = legacy?.password_hash ?? hashPassword(config.adminPassword);
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, is_active, created_at, updated_at)
     VALUES (1, 'admin', 'Admin', ?, 'ADMIN', 1, ?, ?)`
  ).run(passwordHash, stamp, stamp);
}

export function getUserById(id: number): UserInfo | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function listUsers(): UserInfo[] {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, lower(username) ASC")
    .all() as unknown as UserRow[];
  return rows.map(mapUser);
}

export function getUserAuthByUsername(username: string): UserRow | null {
  ensureAdminUser();
  const row = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username) as unknown as
    | UserRow
    | undefined;
  return row ?? null;
}

export function getUserAuthById(id: number): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  return row ?? null;
}

export function verifyUserPassword(username: string, password: string): UserInfo | null {
  const row = getUserAuthByUsername(username);
  if (!row || !row.is_active) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return mapUser(row);
}

export function verifyUserTotp(userId: number, code: string): boolean {
  const row = getUserAuthById(userId);
  if (!row || !row.is_active || !row.totp_enabled || !row.totp_secret_encrypted) return false;
  const counter = currentTotpCounter();
  if (row.totp_last_counter !== null && counter <= row.totp_last_counter) return false;
  const secret = decryptSecret(row.totp_secret_encrypted);
  if (!verifyTotpCode(secret, code)) return false;
  db.prepare('UPDATE users SET totp_last_counter = ?, updated_at = ? WHERE id = ?').run(counter, nowIso(), userId);
  return true;
}

export function storeTotpSetup(userId: number, encryptedSecret: string): void {
  const result = db
    .prepare(
      'UPDATE users SET totp_enabled = 0, totp_secret_encrypted = ?, totp_last_counter = NULL, totp_confirmed_at = NULL, updated_at = ? WHERE id = ?'
    )
    .run(encryptedSecret, nowIso(), userId);
  if (Number(result.changes) === 0) throw notFound('User tidak ditemukan.');
}

export function confirmTotp(userId: number, code: string): boolean {
  const row = getUserAuthById(userId);
  if (!row || !row.totp_secret_encrypted) return false;
  const secret = decryptSecret(row.totp_secret_encrypted);
  if (!verifyTotpCode(secret, code)) return false;
  // Jangan simpan counter di sini agar kode yang sama masih bisa dipakai
  // untuk login pertama; perlindungan replay diterapkan saat login.
  db.prepare(
    'UPDATE users SET totp_enabled = 1, totp_last_counter = NULL, totp_confirmed_at = ?, updated_at = ? WHERE id = ?'
  ).run(nowIso(), nowIso(), userId);
  return true;
}

export function disableTotp(userId: number): void {
  const result = db
    .prepare(
      'UPDATE users SET totp_enabled = 0, totp_secret_encrypted = NULL, totp_last_counter = NULL, totp_confirmed_at = NULL, updated_at = ? WHERE id = ?'
    )
    .run(nowIso(), userId);
  if (Number(result.changes) === 0) throw notFound('User tidak ditemukan.');
}

export function createUser(input: UserCreateInput): UserInfo {
  const stamp = nowIso();
  try {
    const row = db
      .prepare(
        `INSERT INTO users (username, name, password_hash, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         RETURNING *`
      )
      .get(input.username, input.name, hashPassword(input.password), input.role, stamp, stamp) as unknown as UserRow;
    return mapUser(row);
  } catch (error) {
    if (uniqueError(error)) {
      throw new AppError(422, 'DUPLICATE_USER', 'Username sudah dipakai.', {
        username: 'Username sudah dipakai.'
      });
    }
    throw error;
  }
}

export function updateUser(id: number, input: UserUpdateInput): UserInfo {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow | undefined;
  if (!existing) throw notFound('User tidak ditemukan.');

  const willDisableAdmin =
    existing.role === 'ADMIN' && existing.is_active === 1 && (input.isActive === false || input.role === 'VIEWER');
  if (willDisableAdmin) {
    const activeAdmins = (
      db.prepare("SELECT count(*) AS total FROM users WHERE role = 'ADMIN' AND is_active = 1").get() as {
        total: number;
      }
    ).total;
    if (activeAdmins <= 1) {
      throw new AppError(422, 'LAST_ADMIN', 'Tidak dapat menonaktifkan atau menurunkan admin terakhir.');
    }
  }

  const row = db
    .prepare('UPDATE users SET name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ? RETURNING *')
    .get(
      input.name ?? existing.name,
      input.role ?? existing.role,
      input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
      nowIso(),
      id
    ) as unknown as UserRow;
  return mapUser(row);
}

export function updateUserPassword(id: number, newPassword: string): void {
  const result = db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), nowIso(), id);
  if (Number(result.changes) === 0) throw notFound('User tidak ditemukan.');
}

export function resetUserPassword(id: number, newPassword: string): void {
  updateUserPassword(id, newPassword);
}
