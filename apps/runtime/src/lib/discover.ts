import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { git } from './git.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.cache', '__pycache__', '.next']);

const MAX_DEPTH = 4;
const MAX_RESULTS = 200;
const BRANCH_TIMEOUT_MS = 1500;

export interface DiscoveredRepo {
  path: string;
  name: string;
  branch: string | null;
}

function scanRoots(override?: string[]): string[] {
  if (override && override.length > 0) {
    return override.map((root) => (root.startsWith('~') ? root.replace('~', os.homedir()) : root));
  }
  if (config.projectScanRoots.length > 0) {
    return config.projectScanRoots.map((root) => (root.startsWith('~') ? root.replace('~', os.homedir()) : root));
  }
  return [os.homedir()];
}

// Deteksi folder .git dilakukan langsung lewat nama entri di walk(), sehingga
// helper tambahan tidak diperlukan.

async function safeBranch(repoRoot: string): Promise<string | null> {
  try {
    const result = await Promise.race([
      git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), BRANCH_TIMEOUT_MS))
    ]);
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function walk(dir: string, depth: number, results: DiscoveredRepo[], seen: Set<string>): Promise<void> {
  if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) return;

    const full = path.join(dir, entry.name);

    // Repository ditemukan langsung (folder .git di dalamnya)
    if (entry.name === '.git') {
      const repoRoot = dir;
      if (seen.has(repoRoot)) continue;
      seen.add(repoRoot);
      const name = path.basename(repoRoot);
      const branch = await safeBranch(repoRoot);
      results.push({ path: repoRoot, name, branch });
      continue;
    }

    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    await walk(full, depth + 1, results, seen);
  }
}

export async function discoverRepositories(
  query = '',
  rootsOverride?: string[]
): Promise<{ repos: DiscoveredRepo[]; total: number; truncated: boolean }> {
  const roots = scanRoots(rootsOverride);
  const results: DiscoveredRepo[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    await walk(root, 0, results, seen);
    if (results.length >= MAX_RESULTS) break;
  }

  const needle = query.trim().toLowerCase();
  let repos = results;
  if (needle) {
    repos = results.filter(
      (repo) => repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle)
    );
  }

  const truncated = results.length >= MAX_RESULTS;
  repos.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  return { repos, total: repos.length, truncated };
}
