import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-unit-repo-');
let api: ReturnType<typeof request.agent>;
let projectId = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  const login = await api.post('/api/auth/login').send({ password: 'test-password' });
  expect(login.status).toBe(200);
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('menolak password salah dan menerima sesi valid', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ password: 'salah' });
    expect(wrong.status).toBe(401);
    const me = await api.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(1);
  });

  it('membuat pairing token dan memakainya untuk sesi baru', async () => {
    const created = await api.post('/api/pairing').send({ label: 'Test browser' });
    expect(created.status).toBe(201);
    expect(created.body.data.pairUrl).toContain('?pair=');

    const paired = request.agent(app);
    const pair = await paired.post('/api/auth/pair').send({ token: created.body.data.token });
    expect(pair.status).toBe(200);
    expect((await paired.get('/api/auth/me')).status).toBe(200);
  });
});

describe('projects & worktrees', () => {
  it('menambah project, membaca branch, membuat dan menghapus worktree', async () => {
    const project = await api.post('/api/projects').send({ name: 'Test Repo', path: repoDir });
    expect(project.status).toBe(201);
    projectId = project.body.data.id;

    const branches = await api.get(`/api/projects/${projectId}/branches`);
    expect(branches.status).toBe(200);
    expect(branches.body.data).toContain('main');

    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/test-01',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    expect(worktree.body.data.status).toBe('ready');
    expect(fs.existsSync(worktree.body.data.path)).toBe(true);

    const list = await api.get(`/api/worktrees?projectId=${projectId}`);
    expect(list.body.data).toHaveLength(1);

    const removed = await api.delete(`/api/worktrees/${worktree.body.data.id}`);
    expect(removed.status).toBe(204);
    expect(fs.existsSync(worktree.body.data.path)).toBe(false);
  });
});

describe('files', () => {
  it('membaca tree, content, menulis file, dan menolak path traversal', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/files-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);
    const worktreeId = worktree.body.data.id;
    fs.writeFileSync(path.join(worktree.body.data.path, 'hello.txt'), 'hello dorado\n');

    const tree = await api.get(`/api/files/tree?worktreeId=${worktreeId}`);
    expect(tree.status).toBe(200);
    expect(tree.body.data.some((entry: { name: string }) => entry.name === 'hello.txt')).toBe(true);

    const content = await api.get(`/api/files/content?worktreeId=${worktreeId}&path=hello.txt`);
    expect(content.status).toBe(200);
    expect(content.body.data.content).toBe('hello dorado\n');

    const saved = await api.put('/api/files/content').send({
      worktreeId,
      path: 'hello.txt',
      content: 'updated by test\n'
    });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(worktree.body.data.path, 'hello.txt'), 'utf8')).toBe('updated by test\n');

    const traversal = await api.get(`/api/files/content?worktreeId=${worktreeId}&path=..%2F..%2Fetc%2Fpasswd`);
    expect(traversal.status).toBe(422);

    const status = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(status.status).toBe(200);
    expect(status.body.data.files.some((file: { path: string }) => file.path === 'hello.txt')).toBe(true);

    const diff = await api.get(`/api/git/diff?worktreeId=${worktreeId}&path=hello.txt`);
    expect(diff.status).toBe(200);
    expect(diff.body.data.diff).toContain('+updated by test');

    const staged = await api.post('/api/git/stage').send({ worktreeId, path: 'hello.txt' });
    expect(staged.status).toBe(200);
    const afterStage = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(afterStage.body.data.files.find((file: { path: string }) => file.path === 'hello.txt').staged).toBe(true);

    const unstaged = await api.post('/api/git/unstage').send({ worktreeId, path: 'hello.txt' });
    expect(unstaged.status).toBe(200);
    const afterUnstage = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(afterUnstage.body.data.files.find((file: { path: string }) => file.path === 'hello.txt').staged).toBe(false);

    await api.post('/api/git/stage').send({ worktreeId, path: 'hello.txt' });
    const commit = await api.post('/api/git/commit').send({ worktreeId, message: 'test: tambah hello' });
    expect(commit.status).toBe(200);
    expect(commit.body.data.hash).toMatch(/^[a-f0-9]{40}$/);
    const clean = await api.get(`/api/git/status?worktreeId=${worktreeId}`);
    expect(clean.body.data.clean).toBe(true);

    const emptyCommit = await api.post('/api/git/commit').send({ worktreeId, message: 'ab' });
    expect(emptyCommit.status).toBe(422);

    await api.delete(`/api/worktrees/${worktreeId}`);
  });
});

describe('terminals', () => {
  it('membuat, membaca, dan menutup terminal shell', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/terminal-test',
      baseRef: 'main'
    });
    expect(worktree.status).toBe(201);

    const terminal = await api.post('/api/terminals').send({
      worktreeId: worktree.body.data.id,
      title: 'Test Terminal',
      cols: 100,
      rows: 30
    });
    expect(terminal.status).toBe(201);
    expect(terminal.body.data.status).toBe('running');

    const list = await api.get(`/api/terminals?worktreeId=${worktree.body.data.id}`);
    expect(list.body.data).toHaveLength(1);

    const removed = await api.delete(`/api/terminals/${terminal.body.data.id}`);
    expect(removed.status).toBe(204);

    await api.delete(`/api/worktrees/${worktree.body.data.id}`);
  });

  it('menolak agent yang tidak dikenal', async () => {
    const worktree = await api.post('/api/worktrees').send({
      projectId,
      branch: 'agent/unknown-test',
      baseRef: 'main'
    });
    const response = await api.post('/api/sessions').send({
      worktreeId: worktree.body.data.id,
      agent: 'tidak-ada',
      title: 'Unknown',
      prompt: 'test'
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNKNOWN_AGENT');
    await api.delete(`/api/worktrees/${worktree.body.data.id}`);
  });
});