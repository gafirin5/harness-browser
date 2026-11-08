import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
const repoDir = fs.mkdtempSync('/tmp/dorado-preview-repo-');
let api: ReturnType<typeof request.agent>;
let worktreeId = '';
let upstreamPort = 0;
const upstream = http.createServer((req, res) => {
  if ((req.url ?? '').startsWith('/html')) {
    res.writeHead(200, {
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'",
      'content-encoding': 'identity'
    });
    res.end('<html><body><h1>Preview</h1></body></html>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('plain-body');
});

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'preview@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Preview'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# preview\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()));
  upstreamPort = (upstream.address() as AddressInfo).port;

  api = request.agent(app);
  await api.post('/api/auth/login').send({ password: 'test-password' });
  const project = await api.post('/api/projects').send({ name: 'Preview Project', path: repoDir });
  const worktree = await api
    .post('/api/worktrees')
    .send({ projectId: project.body.data.id, branch: 'feature/preview', baseRef: 'main' });
  worktreeId = worktree.body.data.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  terminalManager.shutdown();
  db.close();
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('preview proxy', () => {
  it('memproksi HTML, menyuntik inspector, dan melepas CSP/XFO app target', async () => {
    const res = await api.get(`/api/preview/${worktreeId}/${upstreamPort}/html?inspect=1`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1>Preview</h1>');
    expect(res.text).toContain('/api/preview/inspector.js');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
  });

  it('memproksi non-HTML tanpa injeksi', async () => {
    const res = await api.get(`/api/preview/${worktreeId}/${upstreamPort}/plain`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('plain-body');
  });

  it('menyajikan skrip inspector', async () => {
    const res = await api.get('/api/preview/inspector.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('DORADO_DOM_PICK');
  });

  it('menolak port di luar rentang dan port runtime', async () => {
    const low = await api.get(`/api/preview/${worktreeId}/80`);
    expect(low.status).toBe(422);
    const runtimePort = await api.get(`/api/preview/${worktreeId}/${config.port}`);
    expect(runtimePort.status).toBe(422);
    expect(runtimePort.body.error.code).toBe('BLOCKED_PORT');
  });

  it('menolak metode mutasi dan worktree tak dikenal', async () => {
    const post = await api.post(`/api/preview/${worktreeId}/${upstreamPort}/x`);
    expect(post.status).toBe(405);
    const missing = await api.get('/api/preview/tidak-ada/3000/');
    expect(missing.status).toBe(404);
  });

  it('mengembalikan daftar port worktree', async () => {
    const res = await api.get(`/api/worktrees/${worktreeId}/ports`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.ports)).toBe(true);
  });
});
