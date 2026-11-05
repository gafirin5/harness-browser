import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('login, command palette, orchestrator, dan settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.login-card')).toBeVisible();

  await page.getByLabel('Password').fill('playwright-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');
  await expect(page.locator('.sidebar')).toBeVisible();

  await page.getByRole('button', { name: '⌘K' }).click();
  await expect(page.locator('.palette')).toBeVisible();
  await page.getByLabel('Cari perintah').fill('orchestrator');
  await expect(page.locator('.palette-item')).toContainText('Orchestrator');
  await page.keyboard.press('Escape');
  await expect(page.locator('.palette')).toHaveCount(0);

  await page.getByRole('button', { name: 'Orchestrator' }).click();
  await expect(page.getByRole('dialog', { name: 'Orchestrator' })).toBeVisible();
  await expect(page.getByText('Agent Aktif')).toBeVisible();
  await expect(page.getByText('Biaya Hari Ini')).toBeVisible();
  await page.locator('.orch-head button[aria-label="Tutup"]').click();
  await expect(page.locator('.orch-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Setelan' }).click();
  await expect(page.getByRole('heading', { name: 'Pengaturan Keamanan' })).toBeVisible();
  await expect(page.getByText('Sesi berlaku 8 jam tanpa aktivitas')).toBeVisible();
  await page.locator('.modal button[aria-label="Tutup"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Audit' }).click();
  await expect(page.getByRole('dialog', { name: 'Audit Log' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Login' })).toBeVisible();
  await page.locator('.modal button[aria-label="Tutup"]').click();
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('admin membuat viewer dan viewer masuk mode read-only', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('playwright-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');

  await page.getByRole('button', { name: 'Setelan' }).click();
  const userForm = page.locator('.orch-form');
  await userForm.locator('input').nth(0).fill('pw-viewer');
  await userForm.locator('input').nth(1).fill('Playwright Viewer');
  await userForm.locator('input').nth(2).fill('viewer-pass-123');
  await userForm.getByRole('button', { name: 'Tambah User' }).click();
  await expect(page.getByRole('cell', { name: 'pw-viewer' })).toBeVisible();
  await page.locator('.modal button[aria-label="Tutup"]').click();

  await page.getByRole('button', { name: 'Keluar' }).click();
  await expect(page.locator('.login-card')).toBeVisible();
  await page.getByLabel('Username').fill('pw-viewer');
  await page.getByLabel('Password').fill('viewer-pass-123');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');

  await page.getByRole('button', { name: 'Setelan' }).click();
  await expect(page.getByText('Mode viewer: pengelolaan user hanya tersedia untuk admin.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tambah User' })).toHaveCount(0);
  await page.locator('.modal button[aria-label="Tutup"]').click();
});

test('validasi form ganti password berjalan di browser', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('playwright-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');

  await page.getByRole('button', { name: 'Setelan' }).click();
  const inputs = page.locator('.modal input');
  await inputs.nth(0).fill('password-lama');
  await inputs.nth(1).fill('password-baru-123');
  await inputs.nth(2).fill('password-beda-123');
  await page.getByRole('button', { name: 'Simpan Password' }).click();
  await expect(page.getByText('Konfirmasi password tidak sama.')).toBeVisible();
});

test('keymap global bisa di-remap dan langsung dipakai', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password').fill('playwright-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');

  await page.keyboard.press('Alt+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();

  const input = page.getByLabel('Shortcut Quick Open file');
  await input.click();
  await page.keyboard.press('Control+Shift+U');
  await expect(input).toHaveValue('Ctrl+Shift+U');

  await page.getByRole('button', { name: 'Simpan Keymap' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);

  await page.keyboard.press('Control+Shift+U');
  await expect(page.locator('.quick-open')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.quick-open')).toHaveCount(0);
});

test('hapus sesi agent lewat sidebar', async ({ page }) => {
  const repoDir = fs.mkdtempSync('/tmp/dorado-pw-repo-');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'pw@dorado.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Playwright'], { cwd: repoDir });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# pw\n');
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: repoDir });

  await page.goto('/');
  await page.getByLabel('Password').fill('playwright-password');
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.locator('.topbar-title')).toHaveText('Dorado');

  const projectName = `PW Delete ${Date.now()}`;
  const created = await page.evaluate(
    async ({ repoPath, name }) => {
      const project = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, path: repoPath })
      }).then((response) => response.json());
      const worktree = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.data.id, branch: 'agent/pw-delete', baseRef: 'main' })
      }).then((response) => response.json());
      return { project, worktree };
    },
    { repoPath: repoDir, name: projectName }
  );
  expect(created.worktree.data?.status).toBe('ready');

  await page.reload();
  await page.locator('.project-row', { hasText: projectName }).first().click();
  await page.locator('.worktree-row', { hasText: 'agent/pw-delete' }).first().click();
  await page.getByRole('button', { name: '✦ Agent' }).click();
  await page.locator('.modal select').selectOption({ label: 'Mock Agent' });
  await page.locator('.modal input').first().fill('Delete me');
  const startButton = page.locator('.modal').getByRole('button', { name: 'Jalankan Agent' });
  await expect(startButton).toBeEnabled();
  await startButton.click();

  const sessionRow = page.locator('.session-row', { hasText: 'Delete me' });
  await expect(sessionRow).toBeVisible();
  await sessionRow.getByTitle('Hentikan sesi').click();
  await expect(sessionRow.getByLabel('Hapus sesi Delete me')).toBeVisible();

  page.on('dialog', (dialog) => void dialog.accept());
  await sessionRow.getByLabel('Hapus sesi Delete me').click();
  await expect(sessionRow).toHaveCount(0);
});
