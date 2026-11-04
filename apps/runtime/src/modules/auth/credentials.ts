import bcrypt from 'bcryptjs';
import { config } from '../../config.js';
import { db, nowIso } from '../../db/index.js';

const BCRYPT_COST = 10;

export function ensureAdminCredential(): void {
  const row = db.prepare('SELECT id FROM admin_credentials WHERE id = 1').get() as { id: number } | undefined;
  if (row) return;
  const hash = bcrypt.hashSync(config.adminPassword, BCRYPT_COST);
  db.prepare('INSERT INTO admin_credentials (id, password_hash, updated_at) VALUES (1, ?, ?)').run(hash, nowIso());
}

export function verifyAdminPassword(password: string): boolean {
  ensureAdminCredential();
  const row = db.prepare('SELECT password_hash FROM admin_credentials WHERE id = 1').get() as
    | { password_hash: string }
    | undefined;
  if (!row) return false;
  return bcrypt.compareSync(password, row.password_hash);
}

export function updateAdminPassword(password: string): void {
  ensureAdminCredential();
  const hash = bcrypt.hashSync(password, BCRYPT_COST);
  db.prepare('UPDATE admin_credentials SET password_hash = ?, updated_at = ? WHERE id = 1').run(hash, nowIso());
}