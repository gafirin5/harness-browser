#!/usr/bin/env node
/**
 * Smoke test dengan Chromium 93 (engine branch 4577).
 *
 * Prasyarat:
 *   PUPPETEER93_DIR=/tmp/puppeteer93   (berisi paket puppeteer@10.2 + Chromium 93)
 *   BASE_URL=http://localhost:3001     (jalankan build produksi lebih dulu)
 */
import { createRequire } from 'node:module';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const puppeteerDir = process.env.PUPPETEER93_DIR ?? '/tmp/puppeteer93';
const email = process.env.E2E_EMAIL ?? 'admin@orca.local';
const password = process.env.E2E_PASSWORD ?? 'admin12345';

const requireFrom = createRequire(`${puppeteerDir}/`);
const puppeteer = requireFrom('puppeteer');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });
await browser.defaultBrowserContext().overridePermissions(base, ['clipboard-read', 'clipboard-write']);

// Simulasikan konteks non-secure (mis. http://192.168.x.x) di mana
// navigator.clipboard tidak tersedia, sehingga jalur document.execCommand() diuji.
await page.evaluateOnNewDocument(() => {
  try {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  } catch {
    // abaikan
  }
});

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

const waitText = async (text, timeout = 10_000) => {
  await page.waitForFunction(
    (needle) => document.body.innerText.toLowerCase().includes(needle),
    { timeout },
    text.toLowerCase()
  );
};

const clickText = async (selector, text) => {
  const clicked = await page.evaluate(
    (sel, needle) => {
      const elements = Array.from(document.querySelectorAll(sel));
      const match = elements.find((element) => (element.textContent || '').trim().includes(needle));
      if (!match) return false;
      match.click();
      return true;
    },
    selector,
    text
  );
  if (!clicked) throw new Error(`Elemen ${selector} dengan teks "${text}" tidak ditemukan.`);
};

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 });
  await waitText('Dashboard Orkestrasi');
  await waitText('Agent Aktif');
  console.log('[chrome93] login + dashboard OK');

  await page.goto(`${base}/providers`, { waitUntil: 'networkidle2' });
  await waitText('Manajemen Provider LLM');
  await clickText('button', 'Tambah Provider');
  await page.waitForSelector('input[name="provider-name"]');
  await page.click('button[aria-label="Tutup dialog"]');
  console.log('[chrome93] halaman provider OK');

  await page.goto(`${base}/agents`, { waitUntil: 'networkidle2' });
  await waitText('Manajemen Agent Pekerja');
  await clickText('button', 'Daftarkan Agent');
  await page.waitForSelector('input[name="agent-code"]');
  await page.click('button[aria-label="Tutup dialog"]');
  console.log('[chrome93] halaman agent OK');

  await page.goto(`${base}/tasks`, { waitUntil: 'networkidle2' });
  await waitText('Task & Log Eksekusi');
  await clickText('button', 'Buat Task Baru');
  await page.waitForSelector('input[name="task-title"]');
  await page.waitForFunction(
    () => document.querySelectorAll('select[name="task-agent"] option').length > 1,
    { timeout: 15_000 }
  );

  const agentValue = await page.$eval('select[name="task-agent"]', (element) => element.value);
  if (!agentValue) {
    const firstAgent = await page.$eval('select[name="task-agent"]', (element) => {
      const option = element.querySelectorAll('option')[1];
      return option ? option.value : '';
    });
    if (!firstAgent) throw new Error('Tidak ada agent aktif untuk diuji.');
    await page.select('select[name="task-agent"]', firstAgent);
  }

  const title = `Chrome93 smoke ${new Date().toISOString()}`;
  await page.type('input[name="task-title"]', title);
  await page.type('textarea[name="task-prompt"]', 'abc');
  expectingValidationError = true;
  await page.click('button[type="submit"][form="task-form"]');
  await waitText('Prompt instruksi minimal terdiri dari 10 karakter.');

  const promptSelector = 'textarea[name="task-prompt"]';
  await page.click(promptSelector, { clickCount: 3 });
  await page.type(promptSelector, 'Instruksi pengujian kompatibilitas Chrome 93 untuk antrean task.');
  await page.click('button[type="submit"][form="task-form"]');
  await page.waitForFunction(() => !document.querySelector('#task-form'), { timeout: 10_000 });
  expectingValidationError = false;
  await waitText('Task berhasil masuk antrean.');
  await waitText(title);
  console.log('[chrome93] buat task + validasi OK');

  await clickText('a.btn-ghost', 'Detail');
  await page.waitForFunction(() => /^\/tasks\/\d+$/.test(location.pathname), { timeout: 10_000 });
  await waitText('Log Eksekusi');
  await clickText('button', 'Salin Log');
  await waitText('Log berhasil disalin ke clipboard.');
  console.log('[chrome93] detail task + salin log OK');

  await page.goto(`${base}/settings`, { waitUntil: 'networkidle2' });
  await waitText('Pengaturan Keamanan');
  await clickText('button', 'Keluar');
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 10_000 });
  console.log('[chrome93] pengaturan + logout OK');

  if (consoleErrors.length > 0) {
    console.error('[chrome93] Error konsol terdeteksi:');
    for (const error of consoleErrors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('[chrome93] tidak ada error konsol/pageerror.');
  }
} catch (error) {
  console.error('[chrome93] GAGAL:', error.message);
  try {
    console.error('[chrome93] URL:', page.url());
    console.error('[chrome93] Body:', (await page.evaluate(() => document.body.innerText)).slice(0, 800));
    await page.screenshot({ path: '/tmp/orca-chrome93.png', fullPage: true });
    console.error('[chrome93] Screenshot: /tmp/orca-chrome93.png');
  } catch (diagnosticError) {
    console.error('[chrome93] diagnostik gagal:', diagnosticError.message);
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
