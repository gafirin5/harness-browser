import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRestartPlan,
  getUpdateStatus,
  parseCommitLog,
  pullLatest,
  updateAvailable,
  type UpdateStatus
} from '../src/modules/update/service.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fakeStatus(overrides: Partial<UpdateStatus>): UpdateStatus {
  return {
    enabled: true,
    mode: 'git',
    repoRoot: '/tmp/repo',
    branch: 'dorado',
    remote: 'origin',
    currentVersion: '0.0.0',
    currentCommit: null,
    currentSubject: null,
    upToDate: false,
    behindCount: 0,
    commits: [],
    dirty: false,
    restartCommand: null,
    error: null,
    ...overrides
  };
}

describe('update helper', () => {
  it('parseCommitLog memetakan hash + subject', () => {
    expect(parseCommitLog('abc123\tFix bug\ndef456\tAdd feature\n')).toEqual([
      { hash: 'abc123', subject: 'Fix bug' },
      { hash: 'def456', subject: 'Add feature' }
    ]);
    expect(parseCommitLog('')).toEqual([]);
  });

  it('buildRestartPlan memilih command / re-exec / none', () => {
    expect(buildRestartPlan('systemctl restart dorado', [])).toEqual({
      kind: 'command',
      command: 'systemctl',
      args: ['restart', 'dorado']
    });
    expect(buildRestartPlan('', ['/x/server.js'])).toEqual({ kind: 're-exec', args: ['/x/server.js'] });
    expect(buildRestartPlan('', [])).toEqual({ kind: 'none' });
  });

  it('updateAvailable hanya true saat ada commit baru tanpa error', () => {
    expect(updateAvailable(fakeStatus({ behindCount: 2 }))).toBe(true);
    expect(updateAvailable(fakeStatus({ upToDate: true }))).toBe(false);
    expect(updateAvailable(fakeStatus({ behindCount: 2, error: 'gagal' }))).toBe(false);
    expect(updateAvailable(fakeStatus({ behindCount: 2, enabled: false }))).toBe(false);
  });
});

describe('update git flow', () => {
  const root = fs.mkdtempSync('/tmp/dorado-update-');
  const repoDir = path.join(root, 'repo');
  const remoteDir = path.join(root, 'remote.git');
  const cloneDir = path.join(root, 'clone');

  beforeAll(() => {
    fs.mkdirSync(repoDir, { recursive: true });
    git(repoDir, ['init', '-q', '-b', 'dorado']);
    git(repoDir, ['config', 'user.email', 'u@e.local']);
    git(repoDir, ['config', 'user.name', 'U']);
    fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a\n');
    git(repoDir, ['add', '-A']);
    git(repoDir, ['commit', '-qm', 'init']);
    execFileSync('git', ['init', '--bare', '-q', remoteDir]);
    git(repoDir, ['remote', 'add', 'origin', remoteDir]);
    git(repoDir, ['push', '-u', 'origin', 'dorado']);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('mendeteksi commit baru lalu fast-forward ke versi terbaru', async () => {
    execFileSync('git', ['clone', '-q', '-b', 'dorado', remoteDir, cloneDir]);
    git(cloneDir, ['config', 'user.email', 'u@e.local']);
    git(cloneDir, ['config', 'user.name', 'U']);
    fs.writeFileSync(path.join(cloneDir, 'b.txt'), 'b\n');
    git(cloneDir, ['add', '-A']);
    git(cloneDir, ['commit', '-qm', 'tambah fitur']);
    git(cloneDir, ['push', 'origin', 'dorado']);

    const status = await getUpdateStatus(repoDir);
    expect(status.error).toBeNull();
    expect(status.upToDate).toBe(false);
    expect(status.behindCount).toBe(1);
    expect(status.commits[0]?.subject).toBe('tambah fitur');
    expect(updateAvailable(status)).toBe(true);

    const pull = await pullLatest(repoDir);
    expect(pull.ok).toBe(true);
    expect(fs.existsSync(path.join(repoDir, 'b.txt'))).toBe(true);

    const after = await getUpdateStatus(repoDir);
    expect(after.upToDate).toBe(true);
    expect(after.behindCount).toBe(0);
  });
});
