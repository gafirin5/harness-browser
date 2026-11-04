#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'acorn';

const root = process.argv[2] ?? 'dist';
const files = await collect(root);
const failures = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  try {
    Parser.parse(source, { ecmaVersion: 2020, sourceType: 'module', allowHashBang: true });
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
  }
}
if (failures.length) {
  console.error('Sintaks di atas ES2020:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`[check-syntax] OK — ${files.length} file ES2020.`);

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
