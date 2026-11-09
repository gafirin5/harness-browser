import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import { parseChatBlocks } from '../src/modules/sessions/chat.js';
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

describe('parseChatBlocks', () => {
  it('membuang ANSI, memecah paragraf, dan menandai prompt_wait', () => {
    const raw =
      '\u001b[32mMenganalisis src/login.tsx...\u001b[0m\n\n' +
      'Menambahkan validasi.\n\n' +
      'Apakah ingin menjalankan unit test? (y/n)';
    const blocks = parseChatBlocks(raw);
    expect(blocks.length).toBe(3);
    expect(blocks[0]?.content).toContain('Menganalisis src/login.tsx');
    expect(blocks[0]?.content).not.toContain('\u001b');
    expect(blocks[blocks.length - 1]?.type).toBe('prompt_wait');
  });

  it('tidak menandai bila tidak ada pola prompt', () => {
    const blocks = parseChatBlocks('Selesai.\n\nTidak ada yang menunggu.');
    expect(blocks.every((block) => block.type === 'text')).toBe(true);
  });
});

describe('chat-blocks endpoint', () => {
  it('menyajikan blok dari log terminal', async () => {
    fs.mkdirSync(config.logsDir, { recursive: true });
    const terminalId = 'chat-test-term';
    fs.writeFileSync(path.join(config.logsDir, `${terminalId}.log`), 'Halo\n\nLanjutkan? (y/n)\n');
    const res = await api.get(`/api/terminals/${terminalId}/chat-blocks`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[res.body.data.length - 1].type).toBe('prompt_wait');
  });
});
