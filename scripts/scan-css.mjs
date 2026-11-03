#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';

const forbidden = [
  { pattern: /@layer\b/, label: '@layer' },
  { pattern: /:has\s*\(/, label: ':has()' },
  { pattern: /@container\b/, label: '@container' },
  { pattern: /@property\b/, label: '@property' },
  { pattern: /\b(?:dvh|svh|lvh)\b/, label: 'unit dvh/svh/lvh' },
  { pattern: /\boklch\s*\(/, label: 'oklch()' },
  { pattern: /\bcolor-mix\s*\(/, label: 'color-mix()' },
  { pattern: /\blight-dark\s*\(/, label: 'light-dark()' },
  { pattern: /text-wrap\s*:\s*balance/, label: 'text-wrap: balance' },
  { pattern: /\bpopover\b/, label: 'popover' },
  { pattern: /::view-transition/, label: '::view-transition' },
  { pattern: /scrollbar-gutter/, label: 'scrollbar-gutter' },
  { pattern: /&\s*[.:{>+~]/, label: 'CSS nesting' }
];

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (entry.isFile() && entry.name.endsWith('.css')) files.push(full);
  }
  return files;
}

const files = await collect(root);
const violations = [];

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) violations.push(`${path.relative(root, file)}: ${rule.label}`);
  }
}

if (violations.length > 0) {
  console.error('Ditemukan CSS yang tidak kompatibel dengan Blink 93:');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log(`[scan-css] OK — ${files.length} file diperiksa.`);
