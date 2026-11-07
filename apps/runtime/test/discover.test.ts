import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverRepositories } from '../src/lib/discover.js';

describe('discoverRepositories', () => {
  const tmp = fs.mkdtempSync('/tmp/dorado-discover-');

  beforeAll(() => {
    // Buat struktur: root/repo-a, root/repo-b, root/node_modules/skipped, root/plain-folder
    const repoA = path.join(tmp, 'projects', 'repo-a');
    const repoB = path.join(tmp, 'projects', 'repo-b');
    const skipped = path.join(tmp, 'projects', 'node_modules', 'hidden-repo');
    const plain = path.join(tmp, 'projects', 'plain-folder');

    fs.mkdirSync(repoA, { recursive: true });
    fs.mkdirSync(repoB, { recursive: true });
    fs.mkdirSync(skipped, { recursive: true });
    fs.mkdirSync(plain, { recursive: true });

    for (const dir of [repoA, repoB, skipped]) {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
      execFileSync('git', ['config', 'user.email', 'test@dorado.local'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      execFileSync('git', ['add', '-A'], { cwd: dir });
      execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
    }

    fs.writeFileSync(path.join(plain, 'README.md'), '# not a repo\n');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('menemukan repository git di root dan melewati node_modules', async () => {
    const result = await discoverRepositories('', [path.join(tmp, 'projects')]);
    const names = result.repos.map((repo) => repo.name);

    expect(names).toContain('repo-a');
    expect(names).toContain('repo-b');
    expect(names).not.toContain('hidden-repo');
    expect(names).not.toContain('plain-folder');
    expect(result.truncated).toBe(false);
  });

  it('memfilter hasil berdasarkan query nama', async () => {
    const result = await discoverRepositories('repo-a', [path.join(tmp, 'projects')]);
    expect(result.repos.map((repo) => repo.name)).toEqual(['repo-a']);
  });

  it('mengembalikan branch aktif bila ada', async () => {
    const result = await discoverRepositories('', [path.join(tmp, 'projects')]);
    const repoA = result.repos.find((repo) => repo.name === 'repo-a');
    expect(repoA?.branch).toBe('main');
    expect(repoA?.path).toContain('repo-a');
  });
});
