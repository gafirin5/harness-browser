#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';
const rules = [
  [/\bstructuredClone\s*\(/, 'structuredClone'],
  [/\.findLast\s*\(/, 'findLast'],
  [/\.toSorted\s*\(/, 'toSorted'],
  [/\bPromise\.withResolvers\b/, 'Promise.withResolvers'],
  [/\bAbortSignal\.timeout\b/, 'AbortSignal.timeout'],
  [/\bcrypto\.randomUUID\b/, 'crypto.randomUUID'],
  [/\bObject\.groupBy\b/, 'Object.groupBy'],
  [/\bObject\.hasOwn\b/, 'Object.hasOwn'],
  [/\bArray\.fromAsync\b/, 'Array.fromAsync'],
  [/\.at\s*\(\s*-?\d/, 'Array.prototype.at']
];
const files = await collect(root);
const violations = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const [pattern, label] of rules) {
    if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${label}`);
  }
}
if (violations.length) {
  console.error('API JS tidak kompatibel Chrome 93:');
  for (const item of violations) console.error(` - ${item}`);
  process.exit(1);
}
console.log(`[scan-js] OK — ${files.length} file.`);

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