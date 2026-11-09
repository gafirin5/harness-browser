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
const repoDir = fs.mkdtempSync('/tmp/dorado-agentfiles-repo-');
let api: ReturnType<typeof request.agent>;
let parentToken = '';
let worktreePath = '';

function readSessionToken(terminalId: string): string {
  const file = path.join(config.dataDir, 'launchers', `${terminalId}.json`);
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { env: Record<string, string> }).env.DORADO_SESSION_TOKEN;
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'a@e.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'A'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# a\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Agent Files', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/agent-files', baseRef: 'main' });
  worktreePath = worktree.body.data.path;
  const session = await api
    .post('/api/sessions')
    .send({ worktreeId: worktree.body.data.id, agent: 'mock', title: 'Lead' });
  parentToken = readSessionToken(session.body.data.terminalId);
});

afterAll(async () => {
  terminalManager.killAllSessions();
  await new Promise((resolve) => setTimeout(resolve, 300));
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('agent attachments', () => {
  it('menyimpan lampiran dari token sesi agent', async () => {
    const res = await request(app)
      .post('/api/agent/attachments?name=shot.png')
      .set('x-dorado-session-token', `Bearer ${parentToken}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('png-bytes'));
    expect(res.status).toBe(201);
    expect(res.body.data.path).toBe('.dorado-attachments/shot.png');
    expect(fs.existsSync(path.join(worktreePath, '.dorado-attachments', 'shot.png'))).toBe(true);
  });

  it('menolak ekstensi tidak diizinkan dan token tidak valid', async () => {
    const badExt = await request(app)
      .post('/api/agent/attachments?name=evil.sh')
      .set('x-dorado-session-token', `Bearer ${parentToken}`)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(badExt.status).toBe(422);

    const badToken = await request(app)
      .post('/api/agent/attachments?name=shot.png')
      .set('x-dorado-session-token', 'Bearer nope')
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(badToken.status).toBe(401);
  });
});
