#!/usr/bin/env node
/**
 * Memastikan seluruh bundel JavaScript dapat diparse sebagai ES2020
 * (target sintaks Chrome 93). Acorn menolak sintaks ES2021+ seperti ??=, ||=,
 * numeric separator, atau class static block.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Parser } from 'acorn';

const root = process.argv[2] ?? 'dist';

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
const failures = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  try {
    Parser.parse(source, { ecmaVersion: 2020, sourceType: 'module', allowHashBang: true });
  } catch (error) {
    failures.push(`${path.relative(root, file)}: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error('Ditemukan sintaks di atas ES2020 (tidak kompatibel Chrome 93):');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(`[check-syntax] OK — ${files.length} file diparse sebagai ES2020.`);
