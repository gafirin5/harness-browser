#!/usr/bin/env node
/** Tampilkan penanda versi build Dorado (dari apps/runtime/dist/build-info.json). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'apps/runtime/dist/build-info.json');

if (!fs.existsSync(file)) {
  console.log('Belum ada build-info. Jalankan `npm run build` terlebih dahulu.');
  process.exit(0);
}

const info = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('Dorado — Penanda Versi');
console.log(`Versi  : v${info.version}`);
console.log(`Commit : ${info.commit ?? '?'}${info.branch ? ` (${info.branch})` : ''}`);
if (info.subject) console.log(`Pesan  : ${info.subject}`);
console.log(`Tag    : ${info.tag ?? '(belum ada tag)'}`);
console.log(`Build  : ${info.builtAt ?? '?'}`);
