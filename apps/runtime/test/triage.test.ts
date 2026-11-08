import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';
import { buildCiFixPrompt, buildIssuePrompt, issueBranchName } from '../src/modules/triage/service.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-triage-repo-');
let api: ReturnType<typeof request.agent>;
let projectId = '';
let worktreeId = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'triage@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Triage'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# triage\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });
  // remote lokal non-GitHub agar jalur GitHub diuji sebagai NOT_GITHUB.
  execFileSync('git', ['remote', 'add', 'origin', `${repoDir}/.git`], { cwd: repoDir });

  api = request.agent(app);
  const login = await api.post('/api/auth/login').send({ password: 'test-password' });
  expect(login.status).toBe(200);

  const project = await api.post('/api/projects').send({ name: 'Triage Project', path: repoDir });
  projectId = project.body.data.id;
  const worktree = await api.post('/api/worktrees').send({ projectId, branch: 'feature/triage', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
});

afterAll(async () => {
  terminalManager.killAllSessions();
  await new Promise((resolve) => setTimeout(resolve, 500));
  terminalManager.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 200));
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('triage helpers', () => {
  it('menyusun prompt perbaikan CI dari kegagalan', () => {
    const prompt = buildCiFixPrompt(
      [{ name: 'build · test', conclusion: 'failure', logTail: 'Error: boom' }],
      ['Tolong tambahkan test']
    );
    expect(prompt).toContain('build · test');
    expect(prompt).toContain('Error: boom');
    expect(prompt).toContain('Tolong tambahkan test');
  });

  it('menyusun prompt issue dan nama branch', () => {
    expect(buildIssuePrompt('#42', 'Fix login', 'Detail bug')).toContain('Fix login');
    expect(issueBranchName('#42', 'Fix Login Flow')).toBe('fix/42-fix-login-flow');
  });
});

describe('settings linear key', () => {
  it('menyimpan, membaca, dan menghapus API key Linear (admin)', async () => {
    const put = await api.put('/api/settings/linear').send({ apiKey: 'lin_api_secret_12345678' });
    expect(put.status).toBe(200);
    expect(put.body.data.configured).toBe(true);
    expect(put.body.data.last4).toBe('5678');

    const get = await api.get('/api/settings/linear');
    expect(get.status).toBe(200);
    expect(get.body.data.configured).toBe(true);
    expect(get.body.data.last4).toBe('5678');

    const del = await api.delete('/api/settings/linear');
    expect(del.status).toBe(204);
    const after = await api.get('/api/settings/linear');
    expect(after.body.data.configured).toBe(false);
  });

  it('menolak perubahan dari viewer', async () => {
    await api
      .post('/api/users')
      .send({ username: 'triage-viewer', name: 'Triage Viewer', password: 'viewer-pass-123', role: 'VIEWER' });
    const viewer = request.agent(app);
    await viewer.post('/api/auth/login').send({ username: 'triage-viewer', password: 'viewer-pass-123' });
    const res = await viewer.put('/api/settings/linear').send({ apiKey: 'lin_api_secret_12345678' });
    expect(res.status).toBe(403);
  });
});

describe('CI & issue triage', () => {
  it('menolak checks/fix-ci untuk remote non-GitHub', async () => {
    const checks = await api.get(`/api/worktrees/${worktreeId}/checks`);
    expect(checks.status).toBe(422);
    expect(checks.body.error.code).toBe('NOT_GITHUB');

    const fix = await api.post(`/api/worktrees/${worktreeId}/fix-ci`).send({ agentId: 'mock' });
    expect(fix.status).toBe(422);
    expect(fix.body.error.code).toBe('NOT_GITHUB');
  });

  it('membuat worktree + sesi dari issue GitHub (title/body diberikan)', async () => {
    const res = await api.post(`/api/projects/${projectId}/from-issue`).send({
      source: 'github',
      identifier: '#42',
      title: 'Perbaiki login',
      body: 'Login gagal saat token kedaluwarsa.',
      agentId: 'mock'
    });
    expect(res.status).toBe(201);
    expect(res.body.data.branch).toBe('fix/42-perbaiki-login');

    const worktrees = await api.get(`/api/worktrees?projectId=${projectId}`);
    expect(worktrees.body.data.some((item: { id: string }) => item.id === res.body.data.worktreeId)).toBe(true);
    await api.post(`/api/sessions/${res.body.data.sessionId}/stop`);
  });

  it('menolak from-issue Linear tanpa API key', async () => {
    const res = await api
      .post(`/api/projects/${projectId}/from-issue`)
      .send({ source: 'linear', identifier: 'ENG-1', agentId: 'mock' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LINEAR_KEY_MISSING');
  });
});
