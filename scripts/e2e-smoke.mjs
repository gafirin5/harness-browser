#!/usr/bin/env node
/**
 * Smoke test UI dengan Chrome modern (default: google-chrome-stable).
 * Untuk Chrome 93, set CHROME_BIN ke binary 93 dan jalankan alur yang sama.
 */
import puppeteer from 'puppeteer-core';

const base = process.env.BASE_URL ?? 'http://localhost:5173';
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable';
const email = process.env.E2E_EMAIL ?? 'admin@orca.local';
const password = process.env.E2E_PASSWORD ?? 'admin12345';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write']);

const consoleErrors = [];
let expectingValidationError = false;
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.includes('status of 401') || text.includes('status of 404')) return;
  if (expectingValidationError && text.includes('status of 422')) return;
  consoleErrors.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

function fail(message) {
  throw new Error(message);
}

async function waitText(text, timeout = 10_000) {
  await page.waitForFunction(
    (needle) => document.body.innerText.toLowerCase().includes(needle),
    { timeout },
    text.toLowerCase()
  );
}

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 });
  await page.waitForSelector('h1');
  await waitText('Dashboard Orkestrasi');
  await waitText('Agent Aktif');
  console.log('[e2e] login + dashboard OK');

  await page.goto(`${base}/providers`, { waitUntil: 'networkidle2' });
  await waitText('Manajemen Provider LLM');
  await page.locator('button::-p-text(Tambah Provider)').click();
  await page.waitForSelector('input[name="provider-name"]');
  await page.click('button[aria-label="Tutup dialog"]');
  await page.waitForFunction(() => !document.querySelector('input[name="provider-name"]'));
  console.log('[e2e] halaman provider OK');

  await page.goto(`${base}/agents`, { waitUntil: 'networkidle2' });
  await waitText('Manajemen Agent Pekerja');
  await page.locator('button::-p-text(Daftarkan Agent)').click();
  await page.waitForSelector('input[name="agent-code"]');
  await page.click('button[aria-label="Tutup dialog"]');
  console.log('[e2e] halaman agent OK');

  await page.goto(`${base}/tasks`, { waitUntil: 'networkidle2' });
  await waitText('Task & Log Eksekusi');
  await page.locator('button::-p-text(Buat Task Baru)').click();
  await page.waitForSelector('input[name="task-title"]');
  await page.waitForFunction(
    () => document.querySelectorAll('select[name="task-agent"] option').length > 1,
    { timeout: 15_000 }
  );

  const agentValue = await page.$eval('select[name="task-agent"]', (el) => /** @type {HTMLSelectElement} */ (el).value);
  if (!agentValue) {
    const firstAgent = await page.$eval(
      'select[name="task-agent"]',
      (el) => /** @type {HTMLSelectElement} */ (el).options[1]?.value ?? ''
    );
    if (!firstAgent) fail('Tidak ada agent aktif untuk diuji.');
    await page.select('select[name="task-agent"]', firstAgent);
  }

  const title = `E2E smoke ${new Date().toISOString()}`;
  await page.type('input[name="task-title"]', title);
  await page.type('textarea[name="task-prompt"]', 'abc');
  expectingValidationError = true;
  await page.click('button[type="submit"][form="task-form"]');
  await waitText('Prompt instruksi minimal terdiri dari 10 karakter.');

  await page.$eval('textarea[name="task-prompt"]', (el) => {
    /** @type {HTMLTextAreaElement} */ (el).value = '';
  });
  await page.type(
    'textarea[name="task-prompt"]',
    'Instruksi pengujian end-to-end untuk memastikan antrean task berfungsi.'
  );
  await page.click('button[type="submit"][form="task-form"]');
  await page.waitForFunction(() => !document.querySelector('#task-form'), { timeout: 10_000 });
  expectingValidationError = false;
  await waitText('Task berhasil masuk antrean.');
  await waitText(title);
  console.log('[e2e] buat task + validasi OK');

  await page.locator('a.btn-ghost::-p-text(Detail)').click();
  await page.waitForFunction(() => /^\/tasks\/\d+$/.test(location.pathname), { timeout: 10_000 });
  await waitText('Log Eksekusi');
  await page.locator('button::-p-text(Salin Log)').click();
  await waitText('Log berhasil disalin ke clipboard.');
  console.log('[e2e] detail task + salin log OK');

  // EC-002: draf prompt dipulihkan setelah sesi berakhir / halaman dimuat ulang.
  await page.evaluate(() => {
    window.localStorage.setItem(
      'orca.taskDraft.v1',
      JSON.stringify({
        title: 'Draf pemulihan',
        agentId: '',
        providerId: '',
        priority: '2',
        prompt: 'Draf prompt yang dipulihkan secara otomatis.'
      })
    );
  });
  await page.goto(`${base}/tasks`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="task-title"]');
  const draftTitle = await page.$eval('input[name="task-title"]', (element) => element.value);
  if (draftTitle !== 'Draf pemulihan') fail('Draf prompt tidak dipulihkan.');
  await page.evaluate(() => window.localStorage.removeItem('orca.taskDraft.v1'));
  await page.click('button[aria-label="Tutup dialog"]');
  console.log('[e2e] pemulihan draf prompt OK');

  await page.goto(`${base}/settings`, { waitUntil: 'networkidle2' });
  await waitText('Pengaturan Keamanan');
  await page.locator('button::-p-text(Keluar)').click();
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 10_000 });
  console.log('[e2e] pengaturan + logout OK');

  if (consoleErrors.length > 0) {
    console.error('[e2e] Error konsol terdeteksi:');
    for (const error of consoleErrors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('[e2e] tidak ada error konsol/pageerror.');
  }
} catch (error) {
  console.error('[e2e] GAGAL:', error.message);
  try {
    console.error('[e2e] URL:', page.url());
    console.error('[e2e] Body:', (await page.evaluate(() => document.body.innerText)).slice(0, 800));
    await page.screenshot({ path: '/tmp/orca-e2e.png', fullPage: true });
    console.error('[e2e] Screenshot: /tmp/orca-e2e.png');
  } catch (diagnosticError) {
    console.error('[e2e] diagnostik gagal:', diagnosticError.message);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
