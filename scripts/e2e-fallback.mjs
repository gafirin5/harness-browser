#!/usr/bin/env node
/**
 * Memvalidasi EC-006: saat SSE diblokir, frontend beralih ke polling 2 detik.
 * Pemakaian: BASE_URL=http://localhost:3001 node scripts/e2e-fallback.mjs
 */
import puppeteer from 'puppeteer-core';

const base = process.env.BASE_URL ?? 'http://localhost:3001';
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable';
const email = process.env.E2E_EMAIL ?? 'admin@orca.local';
const password = process.env.E2E_PASSWORD ?? 'admin12345';
// BLOCK_SSE=0 menguji stream yang terbuka tetapi dibuffer proxy (mis. quick tunnel).
const blockSse = process.env.BLOCK_SSE !== '0';

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.includes('status of 401') || text.includes('status of 404')) return;
  if (text.includes('ERR_FAILED') || text.includes('events/stream')) return;
  consoleErrors.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

await page.setRequestInterception(true);
page.on('request', (request) => {
  if (request.url().includes('/api/events/stream') && blockSse) {
    void request.abort();
    return;
  }
  void request.continue();
});

const summaryRequests = [];
page.on('request', (request) => {
  if (request.url().includes('/api/dashboard/summary')) summaryRequests.push(Date.now());
});

try {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="email"]');
  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 10_000 });
  await page.waitForFunction(() => document.body.innerText.toLowerCase().includes('dashboard orkestrasi'));

  await page.waitForFunction(
    () => document.body.innerText.toLowerCase().includes('beralih ke mode pembaruan berkala'),
    { timeout: 20_000 }
  );
  console.log('[fallback] banner polling muncul setelah SSE diblokir.');

  summaryRequests.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 4500));
  const count = summaryRequests.length;
  console.log(`[fallback] ${count} request summary dalam 4,5 detik (polling 2 detik).`);
  if (count < 2) {
    throw new Error('Polling tidak berjalan minimal 2 kali dalam 4,5 detik.');
  }

  if (consoleErrors.length > 0) {
    console.error('[fallback] Error konsol tak terduga:');
    for (const error of consoleErrors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('[fallback] tidak ada error konsol tak terduga.');
  }
} catch (error) {
  console.error('[fallback] GAGAL:', error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}