#!/usr/bin/env node
/**
 * Tulis build-info.json (penanda versi build) ke apps/runtime/dist.
 * Dijalankan otomatis setelah `npm run build`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  try {
    return (
      execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
    );
  } catch {
    return null;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const info = {
  version: pkg.version ?? '0.0.0',
  commit: git(['rev-parse', '--short', 'HEAD']),
  subject: git(['log', '-1', '--pretty=%s']),
  branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
  tag: git(['describe', '--tags', '--abbrev=0']),
  builtAt: new Date().toISOString()
};

const outDir = path.join(root, 'apps/runtime/dist');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`[stamp] ${info.version} (${info.commit ?? '?'})${info.tag ? ` ${info.tag}` : ''} @ ${info.builtAt}`);
