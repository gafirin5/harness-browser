#!/usr/bin/env node
/**
 * Menyiapkan provider/agent untuk smoke test UI dan menjalankan mock agent
 * secara detached. Dipakai pada pipeline CI.
 *
 * Pemakaian: BASE_URL=http://127.0.0.1:3001 node scripts/seed-e2e.mjs
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3001';
const email = process.env.E2E_EMAIL ?? process.env.ADMIN_EMAIL ?? 'admin@orca.local';
const password = process.env.E2E_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'admin12345';

async function call(path, options = {}, cookie = '') {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body, headers: response.headers };
}

const login = await call('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password })
});
if (login.status !== 200) {
  throw new Error(`Login seed gagal: ${login.status} ${JSON.stringify(login.body)}`);
}
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

const providerName = 'E2E Provider';
const providers = await call('/api/providers?q=E2E%20Provider&page_size=100', {}, cookie);
let provider = providers.body.data.find((item) => item.name === providerName);
if (!provider) {
  const created = await call(
    '/api/providers',
    {
      method: 'POST',
      body: JSON.stringify({
        name: providerName,
        provider_type: 'LITELLM',
        base_url: 'https://llm.internal/v1',
        api_key: 'sk-e2e-12345678',
        default_model: 'gpt-4o-mini',
        cost_per_1k_tokens: '0.0020'
      })
    },
    cookie
  );
  if (created.status !== 201) throw new Error(`Seed provider gagal: ${JSON.stringify(created.body)}`);
  provider = created.body.data;
} else if (!provider.isActive) {
  await call(`/api/providers/${provider.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) }, cookie);
}

const agentCode = 'E2E-AGENT';
const agents = await call('/api/agents?q=E2E-AGENT&page_size=100', {}, cookie);
let agent = agents.body.data.find((item) => item.code === agentCode);
let token = '';

if (!agent) {
  const created = await call(
    '/api/agents',
    {
      method: 'POST',
      body: JSON.stringify({
        code: agentCode,
        name: 'E2E Agent',
        endpoint_url: 'http://127.0.0.1:9101',
        provider_id: provider.id,
        max_concurrency: 2
      })
    },
    cookie
  );
  if (created.status !== 201) throw new Error(`Seed agent gagal: ${JSON.stringify(created.body)}`);
  agent = created.body.data;
  token = created.body.agentToken;
} else {
  const rotated = await call(`/api/agents/${agent.id}/rotate-token`, { method: 'POST' }, cookie);
  if (rotated.status !== 200) throw new Error(`Rotasi token gagal: ${JSON.stringify(rotated.body)}`);
  token = rotated.body.agentToken;
  if (!agent.isActive) {
    await call(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: true }) }, cookie);
  }
}

const child = spawn(process.execPath, ['scripts/mock-agent.mjs'], {
  env: { ...process.env, AGENT_TOKEN: token, PORT: '9101' },
  detached: true,
  stdio: 'ignore'
});
child.unref();

await new Promise((resolve) => setTimeout(resolve, 800));

console.log(`[seed-e2e] provider=${provider.id} agent=${agent.id} mock-agent berjalan di :9101`);