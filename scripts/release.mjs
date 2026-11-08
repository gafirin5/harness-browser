#!/usr/bin/env node
/**
 * Rilis versi: bump versi, perbarui CHANGELOG, commit, dan tag.
 * Pemakaian: npm run release -- patch|minor|major|X.Y.Z [--push]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const level = args.find((item) => !item.startsWith('--')) ?? 'patch';
const push = args.includes('--push');

const PKG_FILES = [
  'package.json',
  'apps/runtime/package.json',
  'apps/web/package.json',
  'packages/shared/package.json'
];

function git(cmdArgs, opts = {}) {
  return execFileSync('git', cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    ...opts
  }).trim();
}

function bumpVersion(version, release) {
  if (/^\d+\.\d+\.\d+$/.test(release)) return release;
  const parts = version.split('.').map((part) => Number(part) || 0);
  const [major, minor, patch] = parts;
  if (release === 'major') return `${major + 1}.0.0`;
  if (release === 'minor') return `${major}.${minor + 1}.0`;
  if (release === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Level tidak dikenal: ${release} (pakai patch|minor|major|X.Y.Z)`);
}

const dirty = git(['status', '--porcelain']);
if (dirty) {
  console.error('[release] Working tree kotor. Commit/stash dulu sebelum rilis.');
  process.exit(1);
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const current = rootPkg.version;
const next = bumpVersion(current, level);

for (const rel of PKG_FILES) {
  const file = path.join(root, rel);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = next;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

let lastTag = null;
try {
  lastTag = git(['describe', '--tags', '--abbrev=0']);
} catch {
  lastTag = null;
}
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const subjects = git(['log', range, '--pretty=- %s'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
const entry = `## [${next}] - ${date}\n\n${subjects.length ? subjects.join('\n') : '- (tidak ada perubahan)'}\n\n`;

const changelogPath = path.join(root, 'CHANGELOG.md');
const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
const rest = existing.replace(/^# Changelog\r?\n+/, '');
fs.writeFileSync(changelogPath, `# Changelog\n\n${entry}${rest}`);

git(['add', '-A']);
git(['commit', '-m', `chore(release): v${next}`]);
git(['tag', `v${next}`]);

console.log(`[release] v${current} -> v${next} (tag v${next})`);
if (push) {
  git(['push', 'origin', 'HEAD']);
  git(['push', 'origin', `v${next}`]);
  console.log('[release] commit dan tag telah dipush.');
} else {
  console.log(`[release] push dengan: git push origin HEAD && git push origin v${next}`);
}
