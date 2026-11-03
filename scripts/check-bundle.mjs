#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = process.argv[2] ?? 'dist';
const limit = 150 * 1024;
const files = await collect(root);
let total = 0;
for (const file of files) {
  const compressed = gzipSync(await readFile(file), { level: 9 }).length;
  total += compressed;
  console.log(`${String(compressed).padStart(8)} B  ${path.relative(root, file)}`);
}
console.log(`[check-bundle] total ${(total / 1024).toFixed(1)} KB gzip (batas 150 KB)`);
if (total > limit) process.exit(1);

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