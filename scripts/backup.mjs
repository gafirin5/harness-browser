#!/usr/bin/env node
/**
 * Backup konsisten database SQLite Dorado.
 * Pemakaian: DATA_DIR=./data BACKUP_DIR=./backups node scripts/backup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const dbPath = path.join(dataDir, 'dorado.db');
const backupDir = path.resolve(process.env.BACKUP_DIR ?? path.join(dataDir, 'backups'));
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS ?? 30));

if (!fs.existsSync(dbPath)) {
  console.error(`[backup] Database tidak ditemukan: ${dbPath}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/\.\d{3}Z$/, '')
  .replace(/[-:]/g, '')
  .replace('T', '-');
const target = path.join(backupDir, `dorado-${stamp}.db`);

if (fs.existsSync(target)) {
  console.error(`[backup] Target sudah ada: ${target}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  // VACUUM INTO membuat snapshot konsisten tanpa memblokir pembaca.
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally {
  db.close();
}

const verify = new DatabaseSync(target);
try {
  const row = verify.prepare('PRAGMA integrity_check').get();
  const status = row?.integrity_check ?? 'unknown';
  if (status !== 'ok') {
    verify.close();
    fs.rmSync(target, { force: true });
    console.error(`[backup] Integrity check gagal: ${status}`);
    process.exit(1);
  }
} finally {
  verify.close();
}

let removed = 0;
const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const name of fs.readdirSync(backupDir)) {
  if (!name.startsWith('dorado-') || !name.endsWith('.db')) continue;
  const file = path.join(backupDir, name);
  const stat = fs.statSync(file);
  if (stat.mtimeMs < cutoff) {
    fs.rmSync(file, { force: true });
    removed += 1;
  }
}

const size = fs.statSync(target).size;
console.log(`[backup] OK ${target} (${size} byte)`);
if (removed > 0) console.log(`[backup] ${removed} backup lama dihapus (retensi ${retentionDays} hari).`);
console.log(`[backup] Untuk restore: hentikan runtime lalu jalankan node scripts/restore.mjs ${target}`);
