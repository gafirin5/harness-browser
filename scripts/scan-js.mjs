#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';

const forbidden = [
  { pattern: /\bstructuredClone\s*\(/, label: 'structuredClone' },
  { pattern: /\.findLast\s*\(/, label: 'Array.prototype.findLast' },
  { pattern: /\.toSorted\s*\(/, label: 'Array.prototype.toSorted' },
  { pattern: /\.toSpliced\s*\(/, label: 'Array.prototype.toSpliced' },
  { pattern: /\bPromise\.withResolvers\b/, label: 'Promise.withResolvers' },
  { pattern: /\bObject\.groupBy\b/, label: 'Object.groupBy' },
  { pattern: /\bMap\.groupBy\b/, label: 'Map.groupBy' },
  { pattern: /\bAbortSignal\.timeout\b/, label: 'AbortSignal.timeout' },
  { pattern: /\bArray\.fromAsync\b/, label: 'Array.fromAsync' },
  { pattern: /\bcrypto\.randomUUID\b/, label: 'crypto.randomUUID (non-secure context)' },
  { pattern: /\bObject\.hasOwn\b/, label: 'Object.hasOwn' },
  { pattern: /\.at\s*\(\s*-?\d/, label: 'Array.prototype.at' }
];

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
const violations = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) {
      violations.push(`${path.relative(root, file)}: ${rule.label}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Ditemukan API JavaScript yang tidak kompatibel dengan Chrome 93:');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(`[scan-js] OK — ${files.length} file diperiksa.`);
