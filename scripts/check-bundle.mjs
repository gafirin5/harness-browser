#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const INITIAL_LIMIT = 150 * 1024;
const TOTAL_LIMIT = 300 * 1024;

const html = await readFile(path.join(root, 'index.html'), 'utf8').catch(() => '');
const initialRefs = new Set(
  Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)).map((match) => match[1].replace(/^\//, ''))
);

const files = await collect(root);
const rows = [];
let initialTotal = 0;
let total = 0;

for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const compressed = gzipSync(await readFile(file), { level: 9 }).length;
  const initial = initialRefs.has(relative) || (initialRefs.size === 0);
  if (initial) initialTotal += compressed;
  total += compressed;
  rows.push({ relative, compressed, initial });
}

rows.sort((a, b) => b.compressed - a.compressed);
for (const row of rows) {
  console.log(`${row.initial ? 'initial' : 'lazy   '} ${String(row.compressed).padStart(8)} B  ${row.relative}`);
}
console.log(`[check-bundle] initial ${(initialTotal / 1024).toFixed(1)} KB gzip (batas 150 KB)`);
console.log(`[check-bundle] total   ${(total / 1024).toFixed(1)} KB gzip termasuk chunk lazy (batas 300 KB)`);
if (initialTotal > INITIAL_LIMIT || total > TOTAL_LIMIT) process.exit(1);

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}