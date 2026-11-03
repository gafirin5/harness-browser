#!/usr/bin/env node
/**
 * Smoke test Chrome 93: login, project/worktree, terminal PTY, pairing.
 * Pemakaian: BASE_URL=http://127.0.0.1:7788 node scripts/e2e-chrome93.mjs
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:7788';
const password = process.env.DORADO_PASSWORD ?? 'dorado';
const puppeteerDir = process.env.PUPPETEER93_DIR ?? (fs.existsSync('/tmp/puppeteer93') ? '/tmp/puppeteer93' : null);
let puppeteer;
let launchOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
};
if (puppeteerDir) {
  const requireFrom = createRequire(`${puppeteerDir}/`);
  puppeteer = requireFrom('puppeteer');
} else {
  puppeteer = (await import('puppeteer-core')).default;
  launchOptions = {
    ...launchOptions,
    executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable'
  };
}

const repoDir = fs.mkdtempSync('/tmp/dorado-e2e-');
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
execFileSync('git', ['config', 'user.email', 'e2e@dorado.local'], { cwd: repoDir });
execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: repoDir });
fs.writeFileSync(path.join(repoDir, 'README.md'), '# e2e\n');
execFileSync('git', ['add', '-A'], { cwd: repoDir });
execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });
// Remote lokal non-GitHub agar dialog GitHub diuji pada state "bukan GitHub".
execFileSync('git', ['remote', 'add', 'origin', `${repoDir}/.git`], { cwd: repoDir });

async function api(pathname, options = {}, cookie = '') {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) });
if (login.status !== 200) throw new Error(`Login API gagal: ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

const project = await api(
  '/api/projects',
  { method: 'POST', body: JSON.stringify({ name: `E2E ${Date.now()}`, path: repoDir }) },
  cookie
);
if (project.status !== 201) throw new Error(`Seed project gagal: ${JSON.stringify(project.body)}`);
const worktree = await api(
  '/api/worktrees',
  { method: 'POST', body: JSON.stringify({ projectId: project.body.data.id, branch: 'agent/e2e', baseRef: 'main' }) },
  cookie
);
if (worktree.status !== 201) throw new Error(`Seed worktree gagal: ${JSON.stringify(worktree.body)}`);

const browser = await puppeteer.launch(launchOptions);
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

const consoleErrors = [];
const dialogValues = [];
page.on('dialog', async (dialog) => {
  const value = dialogValues.shift();
  try {
    await dialog.accept(value === null ? undefined : value);
  } catch {
    // abaikan dialog yang sudah tertutup
  }
});
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (text.includes('status of 401') || text.includes('status of 404')) return;
  consoleErrors.push(text);
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('response', async (response) => {
  if (!response.url().includes('/api/terminals')) return;
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }
  console.log(`[chrome93] terminal API ${response.status()} ${body.slice(0, 160)}`);
});

const waitText = async (text, timeout = 15000) => {
  await page.waitForFunction(
    (needle) => document.body.innerText.toLowerCase().includes(needle),
    { timeout },
    text.toLowerCase()
  );
};
const clickText = async (selector, text) => {
  const ok = await page.evaluate(
    (sel, needle) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const node = nodes.find((item) => (item.textContent || '').trim().includes(needle));
      if (!node) return false;
      node.click();
      return true;
    },
    selector,
    text
  );
  if (!ok) throw new Error(`Tidak menemukan ${selector} dengan teks ${text}`);
};

let createdProject = project.body.data;
let createdWorktree = worktree.body.data;

try {
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await waitText('Projects');
  await waitText(createdProject.name);
  console.log('[chrome93] login + sidebar OK');

  await clickText('.project-row', createdProject.name);
  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll('.worktree-row')).some((row) => (row.textContent || '').includes(name)),
    { timeout: 15000 },
    createdWorktree.branch
  );
  await clickText('.worktree-row', createdWorktree.branch);
  try {
    await page.waitForFunction(
      (name) => document.querySelector('.worktree-row.active')?.textContent?.includes(name),
      { timeout: 5000 },
      createdWorktree.branch
    );
  } catch {
    await clickText('.worktree-row', createdWorktree.branch);
    await page.waitForFunction(
      (name) => document.querySelector('.worktree-row.active')?.textContent?.includes(name),
      { timeout: 10000 },
      createdWorktree.branch
    );
  }
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (item) => (item.textContent || '').trim() === '+ Terminal'
      );
      return button && !button.disabled;
    },
    { timeout: 10000 }
  );
  console.log('[chrome93] project + worktree OK');

  await clickText('button', '+ Terminal');
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForFunction(
    () => ((document.querySelector('.xterm-rows')?.innerText ?? '').trim().length > 0),
    { timeout: 15000 }
  );
  await page.focus('.xterm-helper-textarea');
  await page.keyboard.type('echo chrome93-ok');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.querySelector('.xterm-rows')?.innerText.includes('chrome93-ok'),
    { timeout: 10000 }
  );
  console.log('[chrome93] terminal PTY + WebSocket OK');

  await page.waitForSelector('.file-row', { timeout: 15000 });
  await clickText('.file-row', 'README.md');
  await page.waitForSelector('.CodeMirror', { timeout: 15000 });
  const original = await page.evaluate(() => document.querySelector('.CodeMirror-code')?.innerText ?? '');
  if (!original.includes('# e2e')) throw new Error('Isi file awal tidak sesuai.');
  await page.click('.CodeMirror');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('# edited by chrome93\n');
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await waitText('File disimpan.');
  const savedFile = await api(
    `/api/files/content?worktreeId=${createdWorktree.id}&path=README.md`,
    {},
    cookie
  );
  if (!savedFile.body?.data?.content?.includes('edited by chrome93')) {
    throw new Error('File tidak tersimpan melalui editor.');
  }
  console.log('[chrome93] file explorer + editor OK');

  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.change-row')).some((row) =>
        (row.textContent || '').includes('README.md')
      ),
    { timeout: 15000 }
  );
  await clickText('.change-row', 'README.md');
  await page.waitForSelector('.diff-view', { timeout: 15000 });
  await waitText('edited by chrome93');
  console.log('[chrome93] git status + diff OK');

  await clickText('button', '+ Terminal');
  await page.waitForFunction(
    () => {
      const terminalTabs = Array.from(document.querySelectorAll('.tab')).filter((tab) =>
        (tab.textContent || '').includes('Terminal')
      );
      const pane = Array.from(document.querySelectorAll('button')).find(
        (button) => (button.textContent || '').trim() === '+ Pane'
      );
      return terminalTabs.length >= 2 && pane && !pane.disabled;
    },
    { timeout: 15000 }
  );
  await clickText('button', '+ Pane');
  await page.waitForSelector('.terminal-panes.panes-2', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-slot').length === 2, { timeout: 15000 });

  await clickText('button', '+ Terminal');
  await page.waitForFunction(
    () => {
      const terminalTabs = Array.from(document.querySelectorAll('.tab')).filter((tab) =>
        (tab.textContent || '').includes('Terminal')
      );
      const pane = Array.from(document.querySelectorAll('button')).find(
        (button) => (button.textContent || '').trim() === '+ Pane'
      );
      return terminalTabs.length >= 3 && pane && !pane.disabled;
    },
    { timeout: 15000 }
  );
  await clickText('button', '+ Pane');
  await page.waitForSelector('.terminal-panes.panes-3', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.terminal-slot').length === 3, { timeout: 15000 });
  await clickText('button', 'Unsplit');
  console.log('[chrome93] terminal split OK');
  await clickText('button', 'Find');
  await page.waitForSelector('.terminal-search', { timeout: 10000 });
  await page.type('.terminal-search input', 'chrome93');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.terminal-search'), { timeout: 10000 });
  console.log('[chrome93] terminal search OK');

  await clickText('button', 'Info');
  await waitText('Info Runtime');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Info Runtime'), { timeout: 10000 });
  console.log('[chrome93] info runtime OK');

  await clickText('button', 'GitHub');
  await waitText('Remote bukan repository GitHub');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Remote bukan repository GitHub'), {
    timeout: 10000
  });
  console.log('[chrome93] github dialog OK');

  const staged = await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.change-row')).find((item) =>
      (item.textContent || '').includes('README.md')
    );
    const button = row?.querySelector('.change-action');
    if (!button) return false;
    button.click();
    return true;
  });
  if (!staged) throw new Error('Tombol stage README.md tidak ditemukan.');
  const stagedStatus = await (async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await api(`/api/git/status?worktreeId=${createdWorktree.id}`, {}, cookie);
      const file = response.body?.data?.files?.find((item) => item.path === 'README.md');
      if (file?.staged) return response.body.data;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('README.md tidak masuk staged setelah klik tombol stage.');
  })();
  console.log(`[chrome93] staged files: ${stagedStatus.files.length}`);

  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('.change-actions button')).find((item) =>
        (item.textContent || '').includes('Commit')
      );
      return button && !button.disabled;
    },
    { timeout: 15000 }
  );
  await clickText('button', 'Commit');
  await page.waitForSelector('.modal textarea', { timeout: 10000 });
  await page.$eval(
    '.modal textarea',
    (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    'chrome93: edit readme'
  );
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('.modal .btn.primary')).find((item) =>
        (item.textContent || '').includes('Commit')
      );
      return button && !button.disabled;
    },
    { timeout: 10000 }
  );
  const committed = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.modal .btn.primary')).find((item) =>
      (item.textContent || '').includes('Commit')
    );
    if (!button) return false;
    button.click();
    return true;
  });
  if (!committed) throw new Error('Tombol commit modal tidak ditemukan.');
  await page.waitForFunction(
    () => {
      const rows = Array.from(document.querySelectorAll('.change-row'));
      return rows.length === 0 && document.body.innerText.toLowerCase().includes('working tree bersih');
    },
    { timeout: 15000 }
  );
  console.log('[chrome93] git stage + commit OK');

  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll('.change-actions button')).find((item) =>
        (item.textContent || '').includes('Push')
      );
      return button && !button.disabled;
    },
    { timeout: 15000 }
  );

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'terminal');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.palette'), { timeout: 10000 });
  console.log('[chrome93] command palette OK');

  dialogValues.push('created-by-e2e.txt');
  await page.evaluate(() => {
    document.querySelector('button[title="File baru"]')?.click();
  });
  await page.waitForFunction(
    () => document.body.innerText.includes('created-by-e2e.txt'),
    { timeout: 15000 }
  );
  await page.waitForSelector('.CodeMirror', { timeout: 15000 });

  dialogValues.push('renamed-by-e2e.txt');
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.file-row')).find((item) =>
      (item.textContent || '').includes('created-by-e2e.txt')
    );
    row?.querySelector('button[title="Rename"]')?.click();
  });
  await page.waitForFunction(
    () => document.body.innerText.includes('renamed-by-e2e.txt'),
    { timeout: 15000 }
  );

  console.log('[chrome93] file create/rename OK');

  await clickText('button', 'History');
  await waitText('Riwayat Sesi Agent');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Riwayat Sesi Agent'), { timeout: 10000 });
  console.log('[chrome93] session history dialog OK');

  await clickText('button', 'Share');
  await waitText('Share & Pairing');
  await clickText('button', 'Buat Pairing Token');
  await waitText('Pairing URL baru');
  await page.click('button[aria-label="Tutup"]');
  console.log('[chrome93] share/pairing dialog OK');

  const tokens = await api('/api/pairing', { method: 'POST', body: JSON.stringify({ label: 'E2E browser' }) }, cookie);
  if (tokens.status !== 201) throw new Error('Gagal membuat token pairing');
  const pairUrl = tokens.body.data.pairUrl.replace(/^https?:\/\/[^/]+/, base);

  const context = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  const pairPage = await context.newPage();
  await pairPage.setViewport({ width: 1366, height: 768 });
  await pairPage.goto(pairUrl, { waitUntil: 'networkidle2' });
  await pairPage.waitForFunction(
    (name) => document.body.innerText.includes(name),
    { timeout: 15000 },
    createdProject.name
  );
  console.log('[chrome93] pairing URL auto-login OK');
  await context.close();

  if (consoleErrors.length > 0) {
    console.error('[chrome93] Error konsol:');
    for (const error of consoleErrors) console.error(` - ${error}`);
    process.exitCode = 1;
  } else {
    console.log('[chrome93] tidak ada error konsol/pageerror.');
  }
} catch (error) {
  console.error('[chrome93] GAGAL:', error.message);
  try { console.error('[chrome93] BODY:', (await page.evaluate(() => document.body.innerText)).slice(-700)); } catch {}
  await page.screenshot({ path: '/tmp/dorado-chrome93.png', fullPage: true }).catch(() => {});
  console.error('[chrome93] Screenshot: /tmp/dorado-chrome93.png');
  process.exitCode = 1;
} finally {
  await browser.close();
  const terminals = await api(`/api/terminals?worktreeId=${createdWorktree.id}`, {}, cookie).catch(() => null);
  for (const terminal of terminals?.body?.data ?? []) {
    await api(`/api/terminals/${terminal.id}`, { method: 'DELETE' }, cookie).catch(() => {});
  }
  await api(`/api/worktrees/${createdWorktree.id}?force=1`, { method: 'DELETE' }, cookie).catch(() => {});
  await api(`/api/projects/${createdProject.id}`, { method: 'DELETE' }, cookie).catch(() => {});
  fs.rmSync(repoDir, { recursive: true, force: true });
}