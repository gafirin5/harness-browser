#!/usr/bin/env node
/**
 * Restore database SQLite Dorado dari file backup.
 * Hentikan runtime terlebih dahulu.
 * Pemakaian: DATA_DIR=./data node scripts/restore.mjs ./backups/dorado-YYYYMMDD-HHMMSS.db
 * FORCE=1 untuk melewati pemeriksaan port runtime.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

const source = process.argv[2];
if (!source) {
  console.error('Pemakaian: node scripts/restore.mjs <file-backup.db>');
  process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const dbPath = path.join(dataDir, 'dorado.db');
const backupSource = path.resolve(source);
const port = Number(process.env.PORT ?? 7788);

if (!fs.existsSync(backupSource)) {
  console.error(`[restore] Backup tidak ditemukan: ${backupSource}`);
  process.exit(1);
}

const verify = new DatabaseSync(backupSource, { readOnly: true });
try {
  const row = verify.prepare('PRAGMA integrity_check').get();
  const status = row?.integrity_check ?? 'unknown';
  if (status !== 'ok') {
    console.error(`[restore] Integrity check backup gagal: ${status}`);
    process.exit(1);
  }
} finally {
  verify.close();
}

function runtimeListening() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

if (process.env.FORCE !== '1' && (await runtimeListening())) {
  console.error(`[restore] Runtime masih berjalan di port ${port}. Hentikan dulu atau set FORCE=1.`);
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });

if (fs.existsSync(dbPath)) {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  const safety = path.join(dataDir, `dorado.pre-restore-${stamp}.db`);
  fs.copyFileSync(dbPath, safety);
  console.log(`[restore] Database lama disimpan di ${safety}`);
}

const staging = path.join(dataDir, 'dorado.restore-tmp.db');
fs.copyFileSync(backupSource, staging);
fs.renameSync(staging, dbPath);
for (const suffix of ['-wal', '-shm']) {
  fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

const finalCheck = new DatabaseSync(dbPath, { readOnly: true });
let ok = false;
try {
  const row = finalCheck.prepare('PRAGMA integrity_check').get();
  ok = (row?.integrity_check ?? '') === 'ok';
} finally {
  finalCheck.close();
}

if (!ok) {
  console.error('[restore] Database hasil restore gagal integrity check.');
  process.exit(1);
}

console.log(`[restore] OK ${dbPath} <- ${backupSource}`);
console.log('[restore] Jalankan ulang runtime Dorado.');
