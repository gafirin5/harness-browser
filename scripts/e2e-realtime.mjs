#!/usr/bin/env node
/**
 * Mengukur latensi pembaruan Dashboard melalui SSE (target <= 2 detik).
 * Pemakaian: BASE_URL=http://localhost:3001 node scripts/e2e-realtime.mjs
 *
 * Opsional: USE_CHROME93=1 dan PUPPETEER93_DIR=/tmp/puppeteer93.
 */
import { createRequire } from 'node:module';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const email = process.env.E2E_EMAIL ?? 'admin@orca.local';
const password = process.env.E2E_PASSWORD ?? 'admin12345';

let puppeteer;
let executablePath;
if (process.env.USE_CHROME93) {
  const dir = process.env.PUPPETEER93_DIR ?? '/tmp/puppeteer93';
  const requireFrom = createRequire(`${dir}/`);
  puppeteer = requireFrom('puppeteer');
  executablePath = puppeteer.executablePath();
} else {
  puppeteer = (await import('puppeteer-core')).default;
  executablePath = process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable';
}

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

async function api(path, options = {}, cookie = '') {
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

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 });
  await page.waitForSelector('[data-testid="summary-running"] [data-testid="summary-value"]');
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="summary-running"] [data-testid="summary-value"]');
    return node && node.textContent !== '';
  });

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  if (login.status !== 200) throw new Error(`Login API gagal: ${login.status}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const agents = await api('/api/agents?page=1&page_size=100', {}, cookie);
  const agent = agents.body.data.find((item) => item.isActive && item.status !== 'OFFLINE');
  if (!agent) throw new Error('Tidak ada agent aktif untuk pengujian realtime.');

  const providers = await api('/api/providers?page=1&page_size=100', {}, cookie);
  const provider = providers.body.data.find((item) => item.isActive);
  if (!provider) throw new Error('Tidak ada provider aktif untuk pengujian realtime.');

  const previous = await page.$eval(
    '[data-testid="summary-running"] [data-testid="summary-value"]',
    (node) => node.textContent
  );

  const started = Date.now();
  const created = await api(
    '/api/tasks',
    {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        title: `Realtime probe ${new Date().toISOString()}`,
        agent_id: agent.id,
        provider_id: provider.id,
        priority: 3,
        prompt: 'Mengukur latensi pembaruan dashboard melalui SSE.'
      })
    },
    cookie
  );
  if (created.status !== 201) throw new Error(`Buat task gagal: ${created.status} ${JSON.stringify(created.body)}`);

  await page.waitForFunction(
    (oldValue) => {
      const node = document.querySelector('[data-testid="summary-running"] [data-testid="summary-value"]');
      return node && node.textContent !== oldValue;
    },
    { polling: 50, timeout: 5000 },
    previous
  );
  const elapsed = Date.now() - started;

  console.log(`[realtime] kartu Task Berjalan berubah dalam ${elapsed} ms (target <= 2000 ms).`);
  if (elapsed > 2000) {
    console.error('[realtime] GAGAL: melebihi target 2 detik.');
    process.exitCode = 1;
  }

  // Bersihkan task agar tidak menumpuk saat pengujian berulang.
  const task = created.body.data;
  await api(`/api/tasks/${task.id}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Selesai pengujian realtime' })
  }, cookie).catch(() => {});
} catch (error) {
  console.error('[realtime] GAGAL:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
