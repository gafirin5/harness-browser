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
const repoDir = fs.mkdtempSync('/tmp/dorado-subagent-repo-');
let api: ReturnType<typeof request.agent>;
let parentToken = '';

function readSessionToken(terminalId: string): string {
  const file = path.join(config.dataDir, 'launchers', `${terminalId}.json`);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { env: Record<string, string> };
  return parsed.env.DORADO_SESSION_TOKEN;
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'sub@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Sub'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# sub\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  const login = await api.post('/api/auth/login').send({ password: 'test-password' });
  expect(login.status).toBe(200);

  const project = await api.post('/api/projects').send({ name: 'Sub Project', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/sub', baseRef: 'main' });
  const session = await api
    .post('/api/sessions')
    .send({ worktreeId: worktree.body.data.id, agent: 'mock', title: 'Lead' });
  expect(session.status).toBe(201);
  parentToken = readSessionToken(session.body.data.terminalId);
});

afterAll(async () => {
  terminalManager.killAllSessions();
  await new Promise((resolve) => setTimeout(resolve, 500));
  terminalManager.shutdown();
  await new Promise((resolve) => setTimeout(resolve, 200));
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('dorado-ctl sub-agents', () => {
  it('menolak token sesi yang tidak valid', async () => {
    const res = await request(app).get('/api/agent/agents').set('x-dorado-session-token', 'Bearer tidak-valid');
    expect(res.status).toBe(401);
  });

  it('mengembalikan daftar agent untuk token valid', async () => {
    const res = await request(app).get('/api/agent/agents').set('x-dorado-session-token', `Bearer ${parentToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((agent: { id: string }) => agent.id === 'mock')).toBe(true);
  });

  it('spawn membuat sub-agent, lalu status dan diff dapat dibaca', async () => {
    const spawn = await request(app)
      .post('/api/agent/subagents')
      .set('x-dorado-session-token', `Bearer ${parentToken}`)
      .send({ agentId: 'mock', prompt: 'tulis unit test' });
    expect(spawn.status).toBe(201);
    expect(spawn.body.data.branch).toContain('sub-');
    const { sessionId, worktreeId } = spawn.body.data as { sessionId: string; worktreeId: string };

    const status = await request(app)
      .get(`/api/agent/subagents/${sessionId}`)
      .set('x-dorado-session-token', `Bearer ${parentToken}`);
    expect(status.status).toBe(200);
    expect(status.body.data.worktreeId).toBe(worktreeId);
    expect(Array.isArray(status.body.data.transcript)).toBe(true);

    const diff = await request(app)
      .get(`/api/agent/subagents/diff/${worktreeId}`)
      .set('x-dorado-session-token', `Bearer ${parentToken}`);
    expect(diff.status).toBe(200);
    expect(typeof diff.body.data.diff).toBe('string');
  });

  it('menegakkan batas konkurensi sub-agent per sesi induk', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/api/agent/subagents')
        .set('x-dorado-session-token', `Bearer ${parentToken}`)
        .send({ agentId: 'mock', prompt: 'kerja' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
