import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { computeCostUsd } from '@orca/shared';
import { createApp } from '../src/app.js';
import { pump } from '../src/dispatcher/index.js';
import { heartbeatOnce } from '../src/heartbeat/index.js';
import { reconcileOnce } from '../src/reconcile/index.js';
import { query } from '../src/db/pool.js';
import { hashPassword } from '../src/auth/password.js';
import { TEST_ADMIN } from './setup.js';

const app = createApp();
type ApiAgent = ReturnType<typeof request.agent>;

let worker: http.Server;
let workerPort = 0;
const received: Array<{ code: string; callback?: string }> = [];

beforeAll(async () => {
  worker = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/tasks') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(raw || '{}') as { task?: { code?: string }; callback?: { url?: string } };
        received.push({ code: payload.task?.code ?? '', callback: payload.callback?.url });
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
      });
      return;
    }
    if (req.method === 'POST' && /^\/tasks\/[^/]+\/cancel$/.test(req.url ?? '')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ cancelled: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    worker.listen(0, '127.0.0.1', () => {
      workerPort = (worker.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => worker.close(() => resolve()));
});

async function login(agent: ApiAgent): Promise<ApiAgent> {
  const response = await agent
    .post('/api/auth/login')
    .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
  expect(response.status).toBe(200);
  return agent;
}

async function newApi(): Promise<ApiAgent> {
  return login(request.agent(app));
}

interface Stack {
  providerId: number;
  agentId: number;
  agentCode: string;
  token: string;
}

async function seedStack(
  api: ApiAgent,
  options: { maxConcurrency?: number; endpointUrl?: string; agentCode?: string } = {}
): Promise<Stack> {
  const provider = await api.post('/api/providers').send({
    name: 'LiteLLM-Main',
    provider_type: 'LITELLM',
    base_url: 'https://llm.internal/v1',
    api_key: 'sk-test-12345678',
    default_model: 'gpt-4o-mini',
    cost_per_1k_tokens: '0.0020'
  });
  expect(provider.status).toBe(201);

  const agentCode = options.agentCode ?? 'AGT-CODER-01';
  const agent = await api.post('/api/agents').send({
    code: agentCode,
    name: 'Coder Agent',
    endpoint_url: options.endpointUrl ?? `http://127.0.0.1:${workerPort}`,
    provider_id: provider.body.data.id as number,
    max_concurrency: options.maxConcurrency ?? 2
  });
  expect(agent.status).toBe(201);

  return {
    providerId: provider.body.data.id as number,
    agentId: agent.body.data.id as number,
    agentCode,
    token: agent.body.agentToken as string
  };
}

async function createTask(
  api: ApiAgent,
  stack: Stack,
  overrides: Record<string, unknown> = {},
  idempotencyKey?: string
): Promise<request.Response> {
  const call = api.post('/api/tasks');
  if (idempotencyKey) call.set('Idempotency-Key', idempotencyKey);
  return call.send({
    title: 'Refactor modul auth',
    agent_id: stack.agentId,
    provider_id: stack.providerId,
    priority: 2,
    prompt: 'Tolong refactor modul autentikasi dan tambahkan pengujian.',
    ...overrides
  });
}

async function getTask(api: ApiAgent, id: number): Promise<Record<string, unknown>> {
  const response = await api.get(`/api/tasks/${id}`);
  expect(response.status).toBe(200);
  return response.body.data as Record<string, unknown>;
}

describe('perhitungan biaya', () => {
  it('membulatkan half-up pada 4 desimal', () => {
    expect(computeCostUsd('0.0020', 2500)).toBe('0.0050');
    expect(computeCostUsd('0.0020', 500)).toBe('0.0010');
    expect(computeCostUsd('0.0020', 1)).toBe('0.0000');
    expect(computeCostUsd('0.0001', 1500)).toBe('0.0002');
    expect(computeCostUsd('0', 10000)).toBe('0.0000');
  });
});

describe('auth', () => {
  it('login, me, dan logout bekerja', async () => {
    const api = await newApi();
    const me = await api.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(TEST_ADMIN.email);
    expect(me.body.data.user.id).toBe(1);

    const logout = await api.post('/api/auth/logout');
    expect(logout.status).toBe(204);

    const after = await api.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('password salah menghasilkan pesan generik', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: 'salah-sekali' });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Email atau password salah.');
  });

  it('menolak sesi yang idle lebih dari 8 jam', async () => {
    const api = await newApi();
    await query(`UPDATE sessions SET last_seen_at = now() - interval '9 hours'`);
    const response = await api.get('/api/tasks');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('mengubah password dan mengakhiri sesi lain', async () => {
    const api = await newApi();
    const wrong = await api.patch('/api/auth/password').send({
      current_password: 'password-salah',
      new_password: 'password-baru-123'
    });
    expect(wrong.status).toBe(422);

    const changed = await api.patch('/api/auth/password').send({
      current_password: TEST_ADMIN.password,
      new_password: 'password-baru-123'
    });
    expect(changed.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: TEST_ADMIN.password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_ADMIN.email, password: 'password-baru-123' });
    expect(newLogin.status).toBe(200);
  });

  it('mengunci akun setelah 5 percobaan gagal', async () => {
    const hash = await hashPassword('password123');
    await query(
      `INSERT INTO users (email, password_hash, name, role, is_active) VALUES ($1, $2, 'Locked', 'ADMIN', true)`,
      ['locked@orca.local', hash]
    );

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ email: 'locked@orca.local', password: 'password-salah' });
      expect([401, 423]).toContain(response.status);
      if (attempt === 5) {
        expect(response.status).toBe(423);
        expect(response.body.error.message).toBe(
          'Akun dikunci sementara selama 15 menit karena terlalu banyak percobaan gagal.'
        );
      }
    }

    const locked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'locked@orca.local', password: 'password123' });
    expect(locked.status).toBe(423);
  });
});

describe('provider', () => {
  it('menolak nama duplikat tanpa membedakan kapital', async () => {
    const api = await newApi();
    const payload = {
      name: 'LiteLLM-Main',
      provider_type: 'LITELLM',
      base_url: 'https://llm.internal/v1',
      api_key: 'sk-test-12345678',
      default_model: 'gpt-4o-mini',
      cost_per_1k_tokens: '0.0020'
    };
    expect((await api.post('/api/providers').send(payload)).status).toBe(201);
    const duplicate = await api.post('/api/providers').send({ ...payload, name: 'litellm-main' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe('Nama provider sudah digunakan. Gunakan nama lain.');
  });

  it('tidak membocorkan API key dan mendukung pencarian', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const list = await api.get('/api/providers?q=lite');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(stack.providerId);
    expect(list.body.data[0].apiKeyLast4).toBe('5678');
    expect(list.body.data[0].apiKey).toBeUndefined();
    expect(list.body.data[0].api_key_encrypted).toBeUndefined();
  });

  it('tidak dapat menonaktifkan provider yang menjadi default agent aktif', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const response = await api.patch(`/api/providers/${stack.providerId}`).send({ is_active: false });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PROVIDER_IN_USE');
  });
});

describe('agent', () => {
  it('menolak batas konkurensi di luar 1-10', async () => {
    const api = await newApi();
    const provider = await api.post('/api/providers').send({
      name: 'Provider-X',
      provider_type: 'LITELLM',
      base_url: 'https://llm.internal/v1',
      api_key: 'sk-test-12345678',
      default_model: 'model-x',
      cost_per_1k_tokens: '0.0020'
    });
    const response = await api.post('/api/agents').send({
      code: 'AGT-X',
      name: 'Agent-X',
      endpoint_url: 'http://127.0.0.1:9101',
      provider_id: provider.body.data.id,
      max_concurrency: 0
    });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe('Batas konkurensi harus bernilai antara 1 hingga 10.');
  });

  it('mendaftarkan agent dengan status IDLE dan token sekali tampil', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    expect(stack.token.startsWith('orca_agt_')).toBe(true);

    const list = await api.get('/api/agents');
    expect(list.status).toBe(200);
    expect(list.body.data[0].status).toBe('IDLE');
    expect(list.body.data[0].activeTasksCount).toBe(0);
    expect(list.body.data[0].token).toBeUndefined();

    const duplicate = await api.post('/api/agents').send({
      code: 'agt-coder-01',
      name: 'Duplikat',
      endpoint_url: 'http://127.0.0.1:9101',
      provider_id: stack.providerId,
      max_concurrency: 1
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.message).toBe('Kode agent sudah terdaftar. Gunakan kode unik lainnya.');
  });

  it('menandai agent OFFLINE saat heartbeat gagal', async () => {
    const api = await newApi();
    await seedStack(api, { endpointUrl: 'http://127.0.0.1:9' });
    await heartbeatOnce();
    const list = await api.get('/api/agents');
    expect(list.body.data[0].status).toBe('OFFLINE');
    expect(list.body.data[0].lastError).toBeTruthy();
  });

  it('menolak penonaktifan agent yang masih memiliki task antre', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    await createTask(api, stack);
    const response = await api.patch(`/api/agents/${stack.agentId}`).send({ is_active: false });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('AGENT_IN_USE');
  });
});

describe('dashboard', () => {
  it('mengembalikan nilai nol saat belum ada data', async () => {
    const api = await newApi();
    const response = await api.get('/api/dashboard/summary');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      agentsActive: 0,
      tasksRunning: 0,
      tasksFailedToday: 0,
      costTodayUsd: '0.0000',
      alerts: [],
      recentLogs: []
    });
  });
});

describe('task lifecycle', () => {
  it('memvalidasi prompt minimal 10 karakter', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const response = await createTask(api, stack, { prompt: 'pendek' });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toBe('Prompt instruksi minimal terdiri dari 10 karakter.');
  });

  it('membuat kode TSK-YYYYMMDD-NNNN dan idempoten terhadap Idempotency-Key', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const key = '11111111-1111-4111-8111-111111111111';

    const first = await createTask(api, stack, {}, key);
    expect(first.status).toBe(201);
    expect(first.body.data.code).toMatch(/^TSK-\d{8}-\d{4}$/);
    expect(first.body.data.status).toBe('QUEUED');

    const second = await createTask(api, stack, {}, key);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.idempotent).toBe(true);
  });

  it('membatalkan task QUEUED dan membuat task retry', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const created = await createTask(api, stack);
    const id = created.body.data.id as number;

    const shortReason = await api.post(`/api/tasks/${id}/cancel`).send({ reason: 'abc' });
    expect(shortReason.status).toBe(422);
    expect(shortReason.body.error.message).toBe('Alasan pembatalan wajib diisi minimal 5 karakter.');

    const cancelled = await api.post(`/api/tasks/${id}/cancel`).send({ reason: 'Task macet di antrean' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const cancelAgain = await api.post(`/api/tasks/${id}/cancel`).send({ reason: 'Dibatalkan lagi' });
    expect(cancelAgain.status).toBe(422);

    const retry = await api.post(`/api/tasks/${id}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).toBe('QUEUED');
    expect(retry.body.data.retryOfTaskId).toBe(id);
    expect(retry.body.data.code).not.toBe(created.body.data.code);
  });

  it('menjalankan dispatcher, menghitung biaya, dan mengelola konkurensi', async () => {
    const api = await newApi();
    const stack = await seedStack(api, { maxConcurrency: 1 });
    received.length = 0;

    const first = await createTask(api, stack);
    const second = await createTask(api, stack);
    const firstId = first.body.data.id as number;
    const secondId = second.body.data.id as number;

    await pump();

    const running = await getTask(api, firstId);
    const queued = await getTask(api, secondId);
    expect(running.status).toBe('RUNNING');
    expect(queued.status).toBe('QUEUED');
    expect(received.map((item) => item.code)).toContain(running.code as string);

    const agentBusy = await api.get('/api/agents');
    expect(agentBusy.body.data[0].activeTasksCount).toBe(1);
    expect(agentBusy.body.data[0].status).toBe('BUSY');

    const result = await request(app)
      .post(`/api/agent/tasks/${running.code as string}/result`)
      .set('authorization', `Bearer ${stack.token}`)
      .send({ status: 'COMPLETED', token_used: 2500, result: 'Selesai' });
    expect(result.status).toBe(200);

    const completed = await getTask(api, firstId);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.tokenUsed).toBe(2500);
    expect(completed.costUsd).toBe('0.0050');

    const duplicate = await request(app)
      .post(`/api/agent/tasks/${running.code as string}/result`)
      .set('authorization', `Bearer ${stack.token}`)
      .send({ status: 'COMPLETED', token_used: 2500 });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.noop).toBe(true);

    const cancelCompleted = await api.post(`/api/tasks/${firstId}/cancel`).send({ reason: 'Terlambat membatalkan' });
    expect(cancelCompleted.status).toBe(422);
    expect(cancelCompleted.body.error.message).toBe('Task yang sudah selesai tidak dapat dibatalkan.');

    await pump();
    const nextRunning = await getTask(api, secondId);
    expect(nextRunning.status).toBe('RUNNING');

    const failed = await request(app)
      .post(`/api/agent/tasks/${nextRunning.code as string}/result`)
      .set('authorization', `Bearer ${stack.token}`)
      .send({ status: 'FAILED', error: { message: 'Worker crash' } });
    expect(failed.status).toBe(200);

    const failedTask = await getTask(api, secondId);
    expect(failedTask.status).toBe('FAILED');
    expect(failedTask.errorMessage).toBe('Worker crash');

    const summary = await api.get('/api/dashboard/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data.costTodayUsd).toBe('0.0050');
    expect(summary.body.data.tasksFailedToday).toBe(1);
    expect(summary.body.data.alerts.some((alert: { type: string }) => alert.type === 'TASK_FAILED')).toBe(true);

    const retry = await api.post(`/api/tasks/${secondId}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.data.status).toBe('QUEUED');

    await pump();
    const retried = await getTask(api, retry.body.data.id as number);
    expect(retried.status).toBe('RUNNING');
    expect(retried.retryOfTaskId).toBe(secondId);
  });

  it('merekatkan ulang counter agent dan menandai task RUNNING yang kedaluwarsa', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const created = await createTask(api, stack);
    const id = created.body.data.id as number;

    await query(
      `UPDATE tasks SET status = 'RUNNING', started_at = now() - interval '2 hours' WHERE id = $1`,
      [id]
    );
    await query(`UPDATE agents SET active_tasks_count = 99, status = 'BUSY' WHERE id = $1`, [stack.agentId]);

    await reconcileOnce();

    const task = await getTask(api, id);
    expect(task.status).toBe('FAILED');
    expect(task.errorMessage).toBe('Melewati batas waktu eksekusi.');

    const agent = await api.get('/api/agents');
    expect(agent.body.data[0].activeTasksCount).toBe(0);
    expect(agent.body.data[0].status).toBe('IDLE');
  });

  it('menolak callback tanpa token dan transisi dari status final', async () => {
    const api = await newApi();
    const stack = await seedStack(api);
    const created = await createTask(api, stack);
    const id = created.body.data.id as number;
    await pump();
    const task = await getTask(api, id);

    const noToken = await request(app)
      .post(`/api/agent/tasks/${task.code as string}/result`)
      .send({ status: 'COMPLETED', token_used: 1 });
    expect(noToken.status).toBe(401);

    await api.post(`/api/tasks/${id}/cancel`).send({ reason: 'Batalkan saat berjalan' });

    const late = await request(app)
      .post(`/api/agent/tasks/${task.code as string}/result`)
      .set('authorization', `Bearer ${stack.token}`)
      .send({ status: 'COMPLETED', token_used: 1 });
    expect(late.status).toBe(422);
    expect(late.body.error.message).toContain('tidak dapat diubah');
  });
});
