import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-delete-repo-');
let api: ReturnType<typeof request.agent>;
let worktreeId = '';
let worktreePath = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'd@e.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'D'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# d\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Delete Project', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/delete', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
  worktreePath = worktree.body.data.path;

  fs.mkdirSync(path.join(worktreePath, 'nested', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(worktreePath, 'nested', 'a.txt'), 'a');
  fs.writeFileSync(path.join(worktreePath, 'nested', 'deep', 'b.txt'), 'b');
  fs.writeFileSync(path.join(worktreePath, 'single.txt'), 's');
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('file delete', () => {
  it('menolak folder tidak kosong tanpa recursive', async () => {
    const res = await api.delete(`/api/files?worktreeId=${worktreeId}&path=${encodeURIComponent('nested')}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('DIRECTORY_NOT_EMPTY');
    expect(fs.existsSync(path.join(worktreePath, 'nested'))).toBe(true);
  });

  it('menghapus folder tidak kosong secara rekursif', async () => {
    const res = await api.delete(
      `/api/files?worktreeId=${worktreeId}&path=${encodeURIComponent('nested')}&recursive=1`
    );
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(worktreePath, 'nested'))).toBe(false);
  });

  it('menghapus satu file', async () => {
    const res = await api.delete(`/api/files?worktreeId=${worktreeId}&path=${encodeURIComponent('single.txt')}`);
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(worktreePath, 'single.txt'))).toBe(false);
  });

  it('menolak menghapus path yang diabaikan (.git)', async () => {
    const res = await api.delete(`/api/files?worktreeId=${worktreeId}&path=${encodeURIComponent('.git')}&recursive=1`);
    expect([422, 404]).toContain(res.status);
  });
});
