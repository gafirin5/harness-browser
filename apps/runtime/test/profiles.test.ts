import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-profiles-repo-');
let api: ReturnType<typeof request.agent>;
let projectId = '';
let worktreeId = '';
let worktreePath = '';

function readSessionEnv(terminalId: string): Record<string, string> {
  const file = path.join(config.dataDir, 'launchers', `${terminalId}.json`);
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { env: Record<string, string> }).env;
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'prof@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Prof'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# prof\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Profiles Project', path: repoDir });
  projectId = project.body.data.id;
  const worktree = await api.post('/api/worktrees').send({ projectId, branch: 'feature/prof', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
  worktreePath = worktree.body.data.path;
});

afterAll(async () => {
  terminalManager.killAllSessions();
  await new Promise((resolve) => setTimeout(resolve, 400));
  terminalManager.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 150));
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('attachments', () => {
  it('menyimpan file yang diizinkan dan menambahkan exclude git', async () => {
    const res = await api
      .post(`/api/worktrees/${worktreeId}/attachments?name=shot.png`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('png-bytes'));
    expect(res.status).toBe(201);
    expect(res.body.data.path).toBe('.dorado-attachments/shot.png');
    expect(fs.existsSync(path.join(worktreePath, '.dorado-attachments', 'shot.png'))).toBe(true);
    const exclude = fs.readFileSync(path.join(repoDir, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('.dorado-attachments/');
  });

  it('menolak ekstensi yang tidak diizinkan dan menyanitasi path', async () => {
    const bad = await api
      .post(`/api/worktrees/${worktreeId}/attachments?name=evil.sh`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_EXTENSION');

    const ok = await api
      .post(`/api/worktrees/${worktreeId}/attachments?name=${encodeURIComponent('../../etc/passwd.png')}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('data'));
    expect(ok.status).toBe(201);
    expect(ok.body.data.path).toBe('.dorado-attachments/passwd.png');
    const saved = path.join(worktreePath, '.dorado-attachments', 'passwd.png');
    expect(fs.existsSync(saved)).toBe(true);
  });
});

describe('agent profiles', () => {
  let profileId = '';

  it('membuat profil aktif dan menyuntikkan env ke sesi agent', async () => {
    const created = await api.post('/api/profiles').send({
      name: 'Mock Profil',
      agentId: 'mock',
      env: { E2E_MARK: 'profile-on', ANTHROPIC_API_KEY: 'sk-x' },
      isActive: true
    });
    expect(created.status).toBe(201);
    expect(created.body.data.isActive).toBe(true);
    expect(created.body.data.envKeys.sort()).toEqual(['ANTHROPIC_API_KEY', 'E2E_MARK']);
    profileId = created.body.data.id;

    const session = await api.post('/api/sessions').send({ worktreeId, agent: 'mock', title: 'Prof' });
    expect(session.status).toBe(201);
    const env = readSessionEnv(session.body.data.terminalId);
    expect(env.E2E_MARK).toBe('profile-on');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-x');
    expect(env.DORADO_SESSION_TOKEN).toBeTruthy();
    await api.post(`/api/sessions/${session.body.data.id}/stop`);
  });

  it('mengaktifkan, mendaftar, dan menghapus profil', async () => {
    const list = await api.get('/api/profiles');
    expect(list.body.data.some((profile: { id: string }) => profile.id === profileId)).toBe(true);

    const activated = await api.post(`/api/profiles/${profileId}/activate`);
    expect(activated.status).toBe(200);

    const removed = await api.delete(`/api/profiles/${profileId}`);
    expect(removed.status).toBe(204);
    const after = await api.get('/api/profiles');
    expect(after.body.data.some((profile: { id: string }) => profile.id === profileId)).toBe(false);
  });

  it('menolak mutasi profil dari viewer', async () => {
    await api
      .post('/api/users')
      .send({ username: 'prof-viewer', name: 'Prof Viewer', password: 'viewer-pass-123', role: 'VIEWER' });
    const viewer = request.agent(app);
    await viewer.post('/api/auth/login').send({ username: 'prof-viewer', password: 'viewer-pass-123' });
    const res = await viewer.post('/api/profiles').send({ name: 'X', agentId: 'mock', env: {} });
    expect(res.status).toBe(403);
  });
});
