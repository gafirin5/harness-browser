import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';
import { sshTunnelShutdown } from '../src/modules/ssh/service.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-ssh-repo-');
let api: ReturnType<typeof request.agent>;
let projectId = '';

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 's@e.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'S'], { cwd: repoDir });
  fs.writeFileSync(`${repoDir}/README.md`, '# s\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'SSH Project', path: repoDir });
  expect(project.status).toBe(201);
  projectId = project.body.data?.id ?? '';
});

afterAll(() => {
  sshTunnelShutdown();
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('ssh tunnels', () => {
  it('membuat, mendaftar, dan menghapus tunnel (admin)', async () => {
    const created = await api.post('/api/ssh-tunnels').send({
      projectId,
      name: 'Dev server',
      host: '127.0.0.1',
      port: 1,
      user: 'deploy',
      localPort: 13000,
      remotePort: 3000
    });
    expect(created.status).toBe(201);
    expect(created.body.data.localPort).toBe(13000);

    const list = await api.get('/api/ssh-tunnels');
    expect(list.body.data.some((tunnel: { id: string }) => tunnel.id === created.body.data.id)).toBe(true);

    const removed = await api.delete(`/api/ssh-tunnels/${created.body.data.id}`);
    expect(removed.status).toBe(204);
  });

  it('menolak port tidak valid', async () => {
    const res = await api.post('/api/ssh-tunnels').send({
      projectId,
      name: 'X',
      host: '127.0.0.1',
      user: 'deploy',
      localPort: 99999,
      remotePort: 3000
    });
    expect(res.status).toBe(422);
  });
});
