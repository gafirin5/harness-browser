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
});

afterAll(() => {
  terminalManager.shutdown();
  db.close();
});

describe('user preferences', () => {
  it('menyimpan dan membaca preferensi (tema)', async () => {
    const put = await api
      .put('/api/user/preferences')
      .send({ appearance: { skin: 'tokyo-night', layout: 'orca-studio' } });
    expect(put.status).toBe(200);

    const get = await api.get('/api/user/preferences');
    expect(get.status).toBe(200);
    expect(get.body.data.appearance).toEqual({ skin: 'tokyo-night', layout: 'orca-studio' });
  });

  it('diizinkan untuk viewer (preferensi per-user, bukan admin-only)', async () => {
    const created = await api
      .post('/api/users')
      .send({ username: 'pref-viewer', name: 'Pref Viewer', password: 'viewer-pass-123', role: 'VIEWER' });
    expect(created.status).toBe(201);
    const viewer = request.agent(app);
    await viewer.post('/api/auth/login').send({ username: 'pref-viewer', password: 'viewer-pass-123' });
    const put = await viewer
      .put('/api/user/preferences')
      .send({ appearance: { skin: 'daylight-frost', layout: 'zen-focus' } });
    expect(put.status).toBe(200);
    const get = await viewer.get('/api/user/preferences');
    expect(get.body.data.appearance.skin).toBe('daylight-frost');
  });
});
