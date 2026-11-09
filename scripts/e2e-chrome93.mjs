#!/usr/bin/env node
/**
 * Smoke test Chrome 93: login, project/worktree, terminal PTY, pairing.
 * Pemakaian: BASE_URL=http://127.0.0.1:7788 node scripts/e2e-chrome93.mjs
 */
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
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
let mockAgent = null;
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
let cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

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
const browserVersion = await browser.version();
console.log(`[chrome93] browser version: ${browserVersion}`);
if (process.env.STRICT_CHROME93 !== 'false' && !/Chrome\/93\./i.test(browserVersion)) {
  throw new Error(`Smoke test mensyaratkan Chromium 93, tetapi terdeteksi: ${browserVersion}`);
}

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

const consoleErrors = [];
const dialogValues = [];
page.on('dialog', async (dialog) => {
  const value = dialogValues.shift();
  try {
    await dialog.accept(typeof value === 'string' ? value : undefined);
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
const closeModal = async () => {
  await page.evaluate(() => {
    const button = document.querySelector('.modal button[aria-label="Tutup"]');
    button?.click();
  });
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 15000 });
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
    (name) =>
      Array.from(document.querySelectorAll('.worktree-row')).some((row) => (row.textContent || '').includes(name)),
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

  await page.select(`select[aria-label="Checkpoint ${createdWorktree.branch}"]`, 'in-progress');
  await waitText('Checkpoint worktree disimpan.');
  await page.type(`textarea[aria-label="Catatan checkpoint ${createdWorktree.branch}"]`, 'Catatan checkpoint E2E');
  await clickText('button', 'Simpan Catatan');
  await page.waitForFunction(
    () => {
      const toast = Array.from(document.querySelectorAll('.toast')).find((item) =>
        (item.textContent || '').includes('Checkpoint worktree disimpan.')
      );
      return Boolean(toast);
    },
    { timeout: 10000 }
  );
  const checkpointList = await api(`/api/worktrees?projectId=${createdProject.id}`, {}, cookie);
  const checkpoint = checkpointList.body?.data?.find((item) => item.id === createdWorktree.id);
  if (checkpoint?.taskStatus !== 'in-progress' || checkpoint?.note !== 'Catatan checkpoint E2E') {
    throw new Error('Checkpoint worktree tidak tersimpan.');
  }
  console.log('[chrome93] worktree checkpoint OK');

  await clickText('button', '+ Terminal');
  await page.waitForSelector('.xterm', { timeout: 15000 });
  await page.waitForFunction(() => (document.querySelector('.xterm-rows')?.innerText ?? '').trim().length > 0, {
    timeout: 15000
  });
  await page.focus('.xterm-helper-textarea');
  await page.keyboard.type('echo chrome93-ok');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.innerText.includes('chrome93-ok'), {
    timeout: 10000
  });
  console.log('[chrome93] terminal PTY + WebSocket OK');

  await clickText('button', 'Tampilan');
  await waitText('Terminal & Keymap');
  await page.select('select[aria-label="Ukuran font terminal"]', '16');
  await clickText('button', 'Simpan');
  await page.waitForFunction(() => !document.body.innerText.includes('Terminal & Keymap'), { timeout: 10000 });
  const terminalPrefs = await page.evaluate(() => {
    try {
      return JSON.parse(window.localStorage.getItem('dorado-terminal-prefs') || '{}');
    } catch {
      return {};
    }
  });
  if (terminalPrefs.fontSize !== 16) throw new Error('Preferensi terminal tidak tersimpan.');
  await clickText('button', 'Reset');
  console.log('[chrome93] terminal settings + reset OK');

  await clickText('button', 'Commands');
  await page.waitForSelector('.quick-command-form input', { timeout: 10000 });
  await page.type('.quick-command-form input', 'E2E Command');
  await page.type('.quick-command-form textarea', 'echo quick-command-e2e');
  await clickText('button', '+ Tambah Command');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.quick-command-row')).some((row) =>
        (row.textContent || '').includes('E2E Command')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.quick-command-row')).find((item) =>
      (item.textContent || '').includes('E2E Command')
    );
    const button = Array.from(row?.querySelectorAll('button') ?? []).find(
      (item) => (item.textContent || '').trim() === 'Run'
    );
    button?.click();
  });
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.innerText.includes('quick-command-e2e'), {
    timeout: 10000
  });
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.quick-command-row')).find((item) =>
      (item.textContent || '').includes('E2E Command')
    );
    const button = Array.from(row?.querySelectorAll('button') ?? []).find(
      (item) => (item.textContent || '').trim() === 'Hapus'
    );
    button?.click();
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.quick-command-row')).some((row) =>
        (row.textContent || '').includes('E2E Command')
      ),
    { timeout: 10000 }
  );
  await clickText('button', 'Tutup');
  await page.waitForFunction(() => !document.querySelector('.quick-command-form'), { timeout: 10000 });
  console.log('[chrome93] quick commands OK');

  await page.waitForSelector('.file-row', { timeout: 15000 });
  await clickText('.file-row', 'README.md');
  await page.waitForSelector('.CodeMirror', { timeout: 15000 });
  const original = await page.evaluate(() => document.querySelector('.CodeMirror-code')?.innerText ?? '');
  if (!original.includes('# e2e')) throw new Error('Isi file awal tidak sesuai.');
  await page.click('.CodeMirror');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('# edited by chrome93\n\n```mermaid\ngraph TD\nA[Mulai] --> B[Selesai]\n```\n');
  await page.keyboard.down('Control');
  await page.keyboard.press('s');
  await page.keyboard.up('Control');
  await waitText('File disimpan.');
  const savedFile = await api(`/api/files/content?worktreeId=${createdWorktree.id}&path=README.md`, {}, cookie);
  if (!savedFile.body?.data?.content?.includes('edited by chrome93')) {
    throw new Error('File tidak tersimpan melalui editor.');
  }
  console.log('[chrome93] file explorer + editor OK');

  await clickText('button', 'Preview');
  await page.waitForSelector('.markdown-preview h1', { timeout: 15000 });
  await page.waitForSelector('.markdown-preview svg[aria-label="Diagram alir Mermaid"]', { timeout: 10000 });
  await page.waitForFunction(
    () => (document.querySelector('.markdown-preview h1')?.textContent ?? '').includes('edited by chrome93'),
    { timeout: 10000 }
  );
  await clickText('button', 'Raw');
  await page.waitForFunction(() => !document.querySelector('.markdown-preview'), { timeout: 10000 });
  console.log('[chrome93] markdown preview + mermaid OK');

  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.change-row')).some((row) => (row.textContent || '').includes('README.md')),
    { timeout: 15000 }
  );
  await clickText('.change-row', 'README.md');
  await page.waitForSelector('.diff-view', { timeout: 15000 });
  await waitText('edited by chrome93');
  console.log('[chrome93] git status + diff OK');

  await page.waitForSelector('.diff-line-no', { timeout: 15000 });
  const gutterLines = await page.$$('.diff-line-no');
  let composerOpen = false;
  for (const node of gutterLines) {
    const text = await node.evaluate((el) => (el.textContent || '').trim());
    if (!text) continue;
    await node.click().catch(() => undefined);
    try {
      await page.waitForSelector('.diff-comment-box textarea', { timeout: 1500 });
      composerOpen = true;
      break;
    } catch {
      // baris ini tidak membuka composer (mis. baris hapus); coba baris berikutnya
    }
  }
  if (!composerOpen) throw new Error('Composer komentar diff tidak terbuka.');
  await page.type('.diff-comment-box textarea', 'Komentar E2E untuk agent');
  await page.keyboard.press('Enter');
  await waitText('Komentar E2E untuk agent');
  const reviewComments = await api(`/api/review?worktreeId=${createdWorktree.id}&path=README.md`, {}, cookie);
  if (reviewComments.body?.data?.length !== 1) {
    throw new Error('Komentar diff tidak tersimpan melalui API.');
  }
  await clickText('button', 'Kirim ke Agent');
  await waitText('Kirim Komentar ke Agent');
  await clickText('button', 'Batal');
  await page.waitForFunction(() => !document.body.innerText.includes('Kirim Komentar ke Agent'), {
    timeout: 10000
  });
  await page.click('button[aria-label^="Tandai komentar"]');
  await page.waitForSelector('.diff-comment.resolved', { timeout: 10000 });
  await page.click('button[aria-label^="Buka kembali komentar"]');
  await page.waitForFunction(() => !document.querySelector('.diff-comment.resolved'), { timeout: 10000 });
  await page.click('button[aria-label^="Hapus komentar"]');
  await page.waitForFunction(() => !document.querySelector('.diff-comment'), { timeout: 10000 });
  console.log('[chrome93] annotate diff OK');

  await clickText('button', 'Cari');
  await page.waitForSelector('.search-form input', { timeout: 10000 });
  await page.type('.search-form input', 'edited by chrome93');
  await page.waitForSelector('.search-match', { timeout: 15000 });
  await page.click('.search-match');
  await page.waitForFunction(
    () => (document.querySelector('.CodeMirror-code')?.innerText ?? '').includes('edited by chrome93'),
    { timeout: 15000 }
  );
  console.log('[chrome93] code search OK');

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

  await page.evaluate(() => {
    document.querySelector('.terminal-chat')?.click();
  });
  await page.waitForSelector('.chat-view', { timeout: 10000 });
  await page.waitForSelector('.chat-view .chat-composer input', { timeout: 10000 });
  await page.evaluate(() => {
    document.querySelector('.terminal-chat')?.click();
  });
  await page.waitForFunction(() => !document.querySelector('.chat-view'), { timeout: 10000 });
  console.log('[chrome93] chat/cli toggle OK');

  await clickText('button', 'Info');
  await waitText('Info Runtime');
  await closeModal();
  console.log('[chrome93] info runtime OK');

  await clickText('button', 'Info');
  await waitText('Info Runtime');
  await clickText('button', 'Kelola Agent');
  await waitText('Preset bawaan siap dipakai');
  await page.waitForFunction(() => document.body.innerText.includes('OpenCode'), { timeout: 10000 });
  await closeModal();
  console.log('[chrome93] agents dialog OK');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'Worktree Racing');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.palette-item')).some((item) =>
        (item.textContent || '').includes('Worktree Racing')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.palette-item')).find((el) =>
      (el.textContent || '').includes('Worktree Racing')
    );
    item?.click();
  });
  await waitText('Base branch');
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Base branch'), { timeout: 10000 });
  console.log('[chrome93] race dialog OK');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'Triage CI');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.palette-item')).some((item) =>
        (item.textContent || '').includes('Triage CI')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.palette-item')).find((el) =>
      (el.textContent || '').includes('Triage CI')
    );
    item?.click();
  });
  await waitText('Periksa CI');
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Periksa CI'), { timeout: 10000 });
  console.log('[chrome93] triage dialog OK');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'Live Preview');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.palette-item')).some((item) =>
        (item.textContent || '').includes('Live Preview')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.palette-item')).find((el) =>
      (el.textContent || '').includes('Live Preview')
    );
    item?.click();
  });
  await waitText('Pilih Elemen');
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Pilih Elemen'), { timeout: 10000 });
  console.log('[chrome93] preview dialog OK');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'Pembaruan Sistem');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.palette-item')).some((item) =>
        (item.textContent || '').includes('Pembaruan Sistem')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.palette-item')).find((el) =>
      (el.textContent || '').includes('Pembaruan Sistem')
    );
    item?.click();
  });
  await waitText('Cek Pembaruan');
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Cek Pembaruan'), { timeout: 10000 });
  console.log('[chrome93] update dialog OK');

  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('p');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette', { timeout: 10000 });
  await page.type('.palette-input', 'Tampilan & Tema');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.palette-item')).some((item) =>
        (item.textContent || '').includes('Tampilan')
      ),
    { timeout: 10000 }
  );
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.palette-item')).find((el) =>
      (el.textContent || '').includes('Tampilan')
    );
    item?.click();
  });
  await waitText('Dorado Gold');
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.skin-card')).find((el) =>
      (el.textContent || '').includes('Tokyo Night')
    );
    card?.click();
  });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-skin') === 'tokyo-night', {
    timeout: 5000
  });
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.skin-card')).find((el) =>
      (el.textContent || '').includes('Dorado Gold')
    );
    card?.click();
  });
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.skin-card')).find((el) =>
      (el.textContent || '').includes('Zen Focus')
    );
    card?.click();
  });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-layout') === 'zen-focus', {
    timeout: 5000
  });
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.skin-card')).find((el) =>
      (el.textContent || '').includes('Orca Studio')
    );
    card?.click();
  });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-layout') === 'orca-studio', {
    timeout: 5000
  });
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Dorado Gold'), { timeout: 10000 });
  console.log('[chrome93] appearance studio OK');

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
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.modal button')).find((item) =>
      (item.textContent || '').includes('Draft AI')
    );
    button?.click();
  });
  await page.waitForFunction(
    () => {
      const area = document.querySelector('.modal textarea');
      return Boolean(area && area.value.trim().length >= 3);
    },
    { timeout: 10000 }
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
    return Boolean(button && !button.disabled);
  });
  if (!committed) throw new Error('Tombol commit modal tidak ditemukan.');
  await page.focus('.modal textarea');
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
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

  await page.keyboard.down('Alt');
  await page.keyboard.press('/');
  await page.keyboard.up('Alt');
  await waitText('Keyboard Shortcuts');
  await waitText('Ctrl+Enter');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Keyboard Shortcuts'), { timeout: 10000 });
  console.log('[chrome93] shortcut help OK');

  await page.keyboard.down('Alt');
  await page.keyboard.press('j');
  await page.keyboard.up('Alt');
  await page.waitForSelector('.palette', { timeout: 10000 });
  const jumpPlaceholder = await page.$eval('.palette-input', (element) => element.getAttribute('placeholder'));
  if (!jumpPlaceholder?.includes('Alt+J')) throw new Error('Jump Palette tidak terbuka lewat Alt+J.');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.palette'), { timeout: 10000 });
  console.log('[chrome93] jump palette OK');

  await page.keyboard.down('Alt');
  await page.keyboard.press('p');
  await page.keyboard.up('Alt');
  await page.waitForSelector('.quick-open', { timeout: 10000 });
  await page.type('.quick-open .palette-input', 'README');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.quick-open .palette-label')).some((item) =>
        (item.textContent || '').includes('README.md')
      ),
    { timeout: 10000 }
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.quick-open'), { timeout: 10000 });
  console.log('[chrome93] quick open OK');

  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.press('g');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
  await page.waitForSelector('.git-graph-panel', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('.git-graph-row').length > 0, { timeout: 15000 });
  await page.click('.git-graph-row');
  await page.waitForSelector('.git-commit-title, .git-commit-files-title', { timeout: 15000 });
  const graphRows = await page.evaluate(() => document.querySelectorAll('.git-graph-row').length);
  console.log(`[chrome93] git graph OK (${graphRows} commit)`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.git-graph-panel'), { timeout: 10000 });

  await clickText('button', 'Auto');
  await waitText('Scheduled Automations');
  await page.waitForFunction(
    () => {
      const select = document.querySelector('select[aria-label="Agent otomasi"]');
      return select && select.options.length >= 1 && select.options[0].value !== '';
    },
    { timeout: 15000 }
  );
  await page.$eval('input[placeholder="Nama otomasi"]', (input) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'E2E Automation');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('input[aria-label="Jadwal otomasi"]', (input) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'manual');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('textarea[placeholder="Prompt yang dijalankan agent..."]', (area) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, 'Cek kondisi repo');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('button', '+ Tambah Otomasi');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.automation-row')).some((row) =>
        (row.textContent || '').includes('E2E Automation')
      ),
    { timeout: 15000 }
  );
  const automationList = await api(`/api/automations?projectId=${createdProject.id}`, {}, cookie);
  if (!automationList.body?.data?.some((item) => item.name === 'E2E Automation' && item.schedule === 'manual')) {
    throw new Error('Otomasi tidak tersimpan melalui API.');
  }
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.automation-row')).find((item) =>
      (item.textContent || '').includes('E2E Automation')
    );
    const button = Array.from(row?.querySelectorAll('button') ?? []).find(
      (item) => (item.textContent || '').trim() === 'Hapus'
    );
    button?.click();
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('.automation-row')).some((row) =>
        (row.textContent || '').includes('E2E Automation')
      ),
    { timeout: 10000 }
  );
  await clickText('button', 'Tutup');
  await page.waitForFunction(() => !document.querySelector('.automation-form'), { timeout: 10000 });
  console.log('[chrome93] scheduled automations OK');

  dialogValues.push('created-by-e2e.txt');
  await page.evaluate(() => {
    document.querySelector('button[title="File baru"]')?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('created-by-e2e.txt'), { timeout: 15000 });
  await page.waitForSelector('.CodeMirror', { timeout: 15000 });

  dialogValues.push('renamed-by-e2e.txt');
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.file-row')).find((item) =>
      (item.textContent || '').includes('created-by-e2e.txt')
    );
    row?.querySelector('button[title="Rename"]')?.click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('renamed-by-e2e.txt'), { timeout: 15000 });

  console.log('[chrome93] file create/rename OK');

  const providerName = `E2E Provider ${Date.now()}`;
  await clickText('button', 'Orchestrator');
  await page.waitForSelector('.orch-panel', { timeout: 15000 });
  await waitText('Agent Aktif');
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.orch-tab')).find(
      (item) => (item.textContent || '').trim() === 'Provider'
    );
    button?.click();
  });
  await page.waitForSelector('.orch-table', { timeout: 10000 });
  await clickText('button', '+ Provider');
  await page.waitForSelector('.orch-form', { timeout: 10000 });
  const providerInputs = await page.$$('.orch-form input');
  if (providerInputs.length < 5) throw new Error('Form provider tidak lengkap.');
  await providerInputs[0].type(providerName);
  await providerInputs[1].type('http://127.0.0.1:9999/v1');
  await providerInputs[2].type('gpt-4o-mini');
  await providerInputs[3].type('sk-e2e-12345678');
  // Input tarif sudah terisi default 0.0020.
  await page.click('.orch-form button[type=submit]');
  await page.waitForFunction((name) => document.body.innerText.includes(name), { timeout: 15000 }, providerName);
  console.log('[chrome93] orchestrator provider UI OK');

  const providerList = await api(`/api/orchestrator/providers?q=${encodeURIComponent(providerName)}`, {}, cookie);
  const provider = providerList.body?.data?.[0];
  if (!provider) throw new Error('Provider hasil UI tidak ditemukan.');

  const mockPort = 19101 + (Date.now() % 500);
  const agentCode = `AGT-E2E-${Date.now() % 100000}`;
  const agentCreated = await api(
    '/api/orchestrator/agents',
    {
      method: 'POST',
      body: JSON.stringify({
        code: agentCode,
        name: 'E2E Worker',
        endpointUrl: `http://127.0.0.1:${mockPort}`,
        providerId: provider.id,
        maxConcurrency: 1
      })
    },
    cookie
  );
  if (agentCreated.status !== 201) throw new Error(`Gagal membuat agent: ${JSON.stringify(agentCreated.body)}`);
  const agent = agentCreated.body.data;
  const agentToken = agentCreated.body.agentToken;

  mockAgent = spawn(process.execPath, ['scripts/mock-orchestrator-agent.mjs'], {
    env: { ...process.env, AGENT_TOKEN: agentToken, PORT: String(mockPort), MOCK_DELAY_MS: '250' },
    stdio: 'ignore'
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const health = await fetch(`http://127.0.0.1:${mockPort}/health`, {
        headers: { authorization: `Bearer ${agentToken}` }
      });
      if (health.ok) break;
    } catch {
      // belum siap
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const taskCreated = await api(
    '/api/orchestrator/tasks',
    {
      method: 'POST',
      body: JSON.stringify({
        title: 'E2E orchestrated task',
        agentId: agent.id,
        providerId: provider.id,
        priority: 2,
        prompt: 'jalankan task e2e orchestrator minimal sepuluh karakter'
      })
    },
    cookie
  );
  if (taskCreated.status !== 201) throw new Error(`Gagal membuat task: ${JSON.stringify(taskCreated.body)}`);
  const task = taskCreated.body.data;
  let completedTask = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const current = await api(`/api/orchestrator/tasks/${task.id}`, {}, cookie);
    if (current.body?.data?.status === 'COMPLETED') {
      completedTask = current.body.data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!completedTask) throw new Error('Task orchestrator tidak selesai.');
  if (completedTask.costUsd !== '0.0050') {
    throw new Error(`Biaya task tidak sesuai: ${completedTask.costUsd}`);
  }

  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.orch-tab')).find(
      (item) => (item.textContent || '').trim() === 'Task'
    );
    button?.click();
  });
  await page.waitForFunction((code) => document.body.innerText.includes(code), { timeout: 15000 }, task.code);
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.orch-table tbody tr')).find((item) =>
      (item.textContent || '').includes('E2E orchestrated task')
    );
    row?.click();
  });
  await page.waitForSelector('.orch-detail', { timeout: 10000 });
  await waitText('Task selesai');
  await page.screenshot({ path: '/tmp/dorado-orchestrator.png' });
  await page.click('.orch-head button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.querySelector('.orch-panel'), { timeout: 10000 });
  console.log('[chrome93] orchestrator task end-to-end OK');

  await clickText('button', 'Setelan');
  await waitText('Pengaturan Keamanan');
  await clickText('button', 'Cabut Sesi Lain');
  await waitText('sesi lain dicabut');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Pengaturan Keamanan'), {
    timeout: 10000
  });
  console.log('[chrome93] settings dialog OK');

  // "Cabut Sesi Lain" juga mencabut sesi API milik script E2E; login ulang
  // agar langkah pairing dan cleanup tetap memakai sesi yang valid.
  const relogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password })
  });
  if (relogin.status !== 200) throw new Error(`Login ulang E2E gagal: ${relogin.status}`);
  cookie = (relogin.headers.get('set-cookie') ?? '').split(';')[0];

  const agentList = await api('/api/agents', {}, cookie);
  const installedAgent = agentList.body?.data?.find((a) => a.installed)?.id ?? 'opencode';

  const e2eSession = await api(
    '/api/sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        worktreeId: createdWorktree.id,
        agent: installedAgent,
        title: 'Sesi E2E Hapus'
      })
    },
    cookie
  );
  if (e2eSession.status !== 201) {
    throw new Error(`Gagal membuat sesi E2E untuk tes hapus: ${JSON.stringify(e2eSession)}`);
  }
  await api(`/api/sessions/${e2eSession.body.data.id}/stop`, { method: 'POST' }, cookie);

  await clickText('button', 'History');
  await waitText('Riwayat Sesi Agent');
  await page.waitForSelector('select[aria-label="Scope riwayat"]', { timeout: 10000 });
  await waitText('Sesi E2E Hapus');
  await clickText('.history-item', 'Sesi E2E Hapus');
  dialogValues.push(true);
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      (item.textContent || '').trim().includes('Hapus Sesi')
    );
    window.setTimeout(() => button?.click(), 0);
  });
  await waitText('Sesi agent dihapus.');
  await page.click('button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Riwayat Sesi Agent'), { timeout: 10000 });
  console.log('[chrome93] session history dialog + delete session OK');

  await clickText('button', 'Inbox');
  await page.waitForSelector('.agent-dashboard', { timeout: 15000 });
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.agent-dashboard .dashboard-tabs button')).find(
      (item) => (item.textContent || '').trim() === 'Board'
    );
    button?.click();
  });
  await waitText('Needs You');
  await waitText('Working');
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.agent-dashboard .dashboard-tabs button')).find((item) =>
      (item.textContent || '').trim().startsWith('Inbox')
    );
    button?.click();
  });
  await page.waitForSelector('.dashboard-inbox', { timeout: 10000 });
  await page.click('.agent-dashboard button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.querySelector('.agent-dashboard'), { timeout: 10000 });
  console.log('[chrome93] agent dashboard + inbox OK');

  await clickText('button', 'Nodes');
  await waitText('Dorado Remote Nodes (Federation)');
  await page.type('input[placeholder*="Nama node"]', 'Chrome93 Remote Node');
  await clickText('button', '+ Tambah Node');
  await waitText('Token Node Baru: Chrome93 Remote Node');
  await page.click('.modal button[aria-label="Tutup"]');
  await page.waitForFunction(() => !document.body.innerText.includes('Dorado Remote Nodes'), { timeout: 10000 });
  console.log('[chrome93] remote nodes dialog OK');

  await clickText('button', 'Share');
  await waitText('Share & Pairing');
  await clickText('button', 'Buat Pairing Token');
  await waitText('Pairing URL baru');
  await page.click('button[aria-label="Tutup"]');
  console.log('[chrome93] share/pairing dialog OK');

  await page.setViewport({ width: 390, height: 780 });
  await page.waitForSelector('.mobile-bar', { timeout: 10000, visible: true });
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.mobile-bar button')).find((item) =>
      (item.textContent || '').includes('Project')
    );
    button?.click();
  });
  await page.waitForFunction(() => document.querySelector('.app')?.classList.contains('sidebar-open'), {
    timeout: 5000
  });
  await page.evaluate(() => {
    document.querySelector('.mobile-scrim')?.click();
  });
  await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-open'), {
    timeout: 5000
  });
  await page.setViewport({ width: 1366, height: 768 });
  console.log('[chrome93] mobile companion OK');

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
  try {
    console.error('[chrome93] BODY:', (await page.evaluate(() => document.body.innerText)).slice(-700));
  } catch {
    /* abaikan */
  }
  await page.screenshot({ path: '/tmp/dorado-chrome93.png', fullPage: true }).catch(() => {});
  console.error('[chrome93] Screenshot: /tmp/dorado-chrome93.png');
  process.exitCode = 1;
} finally {
  if (mockAgent) {
    try {
      mockAgent.kill('SIGTERM');
    } catch {
      /* abaikan */
    }
  }
  await browser.close();
  const terminals = await api(`/api/terminals?worktreeId=${createdWorktree.id}`, {}, cookie).catch(() => null);
  for (const terminal of terminals?.body?.data ?? []) {
    await api(`/api/terminals/${terminal.id}`, { method: 'DELETE' }, cookie).catch(() => {});
  }
  await api(`/api/worktrees/${createdWorktree.id}?force=1`, { method: 'DELETE' }, cookie).catch(() => {});
  await api(`/api/projects/${createdProject.id}`, { method: 'DELETE' }, cookie).catch(() => {});
  fs.rmSync(repoDir, { recursive: true, force: true });
}
