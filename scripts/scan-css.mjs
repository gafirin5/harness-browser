#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2] ?? 'dist';
const rules = [
  [/@layer\b/, '@layer'],
  [/@container\b/, '@container'],
  [/@property\b/, '@property'],
  [/:has\s*\(/, ':has()'],
  [/\b(?:dvh|svh|lvh)\b/, 'dvh/svh/lvh'],
  [/\boklch\s*\(/, 'oklch()'],
  [/\bcolor-mix\s*\(/, 'color-mix()'],
  [/\blight-dark\s*\(/, 'light-dark()'],
  [/text-wrap\s*:\s*balance/, 'text-wrap:balance'],
  [/::view-transition/, 'view-transition'],
  [/scrollbar-gutter/, 'scrollbar-gutter'],
  [/&\s*[.:{>+~]/, 'CSS nesting']
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
  console.error('CSS tidak kompatibel Blink 93:');
  for (const item of violations) console.error(` - ${item}`);
  process.exit(1);
}
console.log(`[scan-css] OK — ${files.length} file.`);

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full)));
    else if (entry.isFile() && entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}