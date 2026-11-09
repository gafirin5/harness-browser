import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-preview-files-repo-');
let api: ReturnType<typeof request.agent>;
let worktreeId = '';
let worktreePath = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'f@e.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'F'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# f\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Preview Files', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/preview', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
  worktreePath = worktree.body.data.path;

  fs.writeFileSync(path.join(worktreePath, 'data.csv'), 'name,age\nbudi,30\nsiti,25\n');
  fs.writeFileSync(path.join(worktreePath, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.writeFileSync(path.join(worktreePath, 'doc.pdf'), '%PDF-1.4 dummy');
  fs.writeFileSync(path.join(worktreePath, 'note.bin'), Buffer.from([0, 1, 2, 3]));
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('file preview', () => {
  it('menyajikan CSV dengan content-type benar', async () => {
    const res = await api.get(`/api/files/preview?worktreeId=${worktreeId}&path=data.csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('budi,30');
  });

  it('menyajikan PDF sebagai inline + frame-ancestors self', async () => {
    const res = await api.get(`/api/files/preview?worktreeId=${worktreeId}&path=doc.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('sandbox untuk SVG', async () => {
    const res = await api.get(`/api/files/preview?worktreeId=${worktreeId}&path=icon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('menolak tipe tak dikenal dan path traversal', async () => {
    const unsupported = await api.get(`/api/files/preview?worktreeId=${worktreeId}&path=note.bin`);
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error.code).toBe('UNSUPPORTED');

    const traversal = await api.get(
      `/api/files/preview?worktreeId=${worktreeId}&path=${encodeURIComponent('../../etc/passwd')}`
    );
    expect([422, 404]).toContain(traversal.status);
  });
});
