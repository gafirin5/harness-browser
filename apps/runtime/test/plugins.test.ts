import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/index.js';
import { terminalManager } from '../src/modules/terminals/manager.js';

const app = createApp();
let api: ReturnType<typeof request.agent>;

beforeAll(async () => {
  api = request.agent(app);
  const login = await api.post('/api/auth/login').send({ password: 'test-password' });
  expect(login.status).toBe(200);
  await api
    .post('/api/users')
    .send({ username: 'plugin-viewer', name: 'Plugin Viewer', password: 'viewer-pass-123', role: 'VIEWER' });
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
});

describe('plugins', () => {
  it('memasang plugin, menyajikan styles.css tersanitasi, lalu menghapusnya', async () => {
    const install = await api.post('/api/plugins').send({
      manifest: { id: 'neon', name: 'Cyberpunk Neon', version: '1.0.0', cssVars: { '--accent': '#ff007f' } },
      css: '@import url(https://evil.example.com/x.css); .badge { letter-spacing: 0.05em; }'
    });
    expect(install.status).toBe(201);
    expect(install.body.data.id).toBe('neon');
    expect(install.body.data.vars).toContain('--accent');

    const list = await api.get('/api/plugins');
    expect(list.body.data.some((plugin: { id: string }) => plugin.id === 'neon')).toBe(true);

    const css = await api.get('/api/plugins/styles.css');
    expect(css.status).toBe(200);
    expect(css.text).toContain('html[data-skin="neon"]');
    expect(css.text).toContain('--accent: #ff007f');
    expect(css.text).not.toContain('@import');
    expect(css.text).toContain('.badge');

    const removed = await api.delete('/api/plugins/neon');
    expect(removed.status).toBe(204);
  });

  it('menolak id plugin tidak valid dan mutasi dari viewer', async () => {
    const bad = await api.post('/api/plugins').send({ manifest: { id: 'Bad Id!', name: 'X' } });
    expect(bad.status).toBe(422);

    const viewer = request.agent(app);
    await viewer.post('/api/auth/login').send({ username: 'plugin-viewer', password: 'viewer-pass-123' });
    const blocked = await viewer.post('/api/plugins').send({ manifest: { id: 'ok', name: 'OK' } });
    expect(blocked.status).toBe(403);
  });
});
