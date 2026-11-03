#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const MAX_INITIAL_JS = 150 * 1024;

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

const files = await collect(root);
let total = 0;
const rows = [];

for (const file of files) {
  const buffer = await readFile(file);
  const compressed = gzipSync(buffer, { level: 9 }).length;
  total += compressed;
  rows.push({ file: path.relative(root, file), raw: (await stat(file)).size, gzip: compressed });
}

rows.sort((a, b) => b.gzip - a.gzip);
for (const row of rows) {
  console.log(`${row.gzip.toString().padStart(8)} B gzip  ${(row.raw / 1024).toFixed(1).padStart(8)} KB  ${row.file}`);
}
console.log(`[check-bundle] total JS gzip: ${(total / 1024).toFixed(1)} KB (batas 150.0 KB)`);

if (total > MAX_INITIAL_JS) {
  console.error('[check-bundle] GAGAL: ukuran bundel melebihi batas.');
  process.exit(1);
}
console.log('[check-bundle] OK');
