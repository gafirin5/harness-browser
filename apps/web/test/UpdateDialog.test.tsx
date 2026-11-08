import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UpdateDialog } from '../src/components/UpdateDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const mockedGet = vi.mocked(apiGet);

const status = {
  enabled: true,
  mode: 'git',
  repoRoot: '/opt/dorado',
  branch: 'dorado',
  remote: 'origin',
  currentVersion: '0.2.0',
  currentCommit: 'abc1234',
  currentSubject: 'init',
  currentTag: 'v0.2.0',
  latestTag: 'v0.2.0',
  upToDate: false,
  behindCount: 2,
  commits: [
    { hash: 'aaa1111', subject: 'tambah fitur A' },
    { hash: 'bbb2222', subject: 'perbaiki bug B' }
  ],
  dirty: false,
  restartCommand: null,
  error: null
};

const history = [
  {
    at: '2026-11-09T08:12:00.000Z',
    from: { version: '0.1.0', commit: 'abc1234' },
    to: { version: '0.2.0', commit: 'abc1234' },
    ok: true
  }
];

function mockApi(s: unknown, h: unknown[] = []): void {
  mockedGet.mockImplementation(((path: string) =>
    Promise.resolve(path === '/update/history' ? { data: h } : { data: s })) as never);
}

function renderDialog(isAdmin: boolean): void {
  render(
    <ToastProvider>
      <UpdateDialog isAdmin={isAdmin} onClose={() => undefined} />
    </ToastProvider>
  );
}

describe('UpdateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('menampilkan versi/tag saat ini dan daftar commit baru', async () => {
    mockApi(status, history);
    renderDialog(true);

    await waitFor(() => expect(screen.getByText('Tag terbaru')).toBeTruthy());
    expect(screen.getByText('tambah fitur A')).toBeTruthy();
    expect(screen.getByText('perbaiki bug B')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update Sekarang' })).toBeTruthy();
  });

  it('menampilkan riwayat pembaruan', async () => {
    mockApi(status, history);
    renderDialog(true);

    await waitFor(() => expect(screen.getByText('Riwayat Pembaruan')).toBeTruthy());
    expect(screen.getByText(/v0\.1\.0 → v0\.2\.0/)).toBeTruthy();
  });

  it('menonaktifkan update saat working tree kotor', async () => {
    mockApi({ ...status, dirty: true });
    renderDialog(true);

    await waitFor(() =>
      expect(screen.getByText('Working tree kotor — commit/stash dulu sebelum update.')).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: 'Update Sekarang' })).toBeDisabled();
  });

  it('menampilkan peringatan untuk viewer', async () => {
    mockApi(status);
    renderDialog(false);

    await waitFor(() => expect(screen.getByText('Hanya admin yang dapat memperbarui sistem.')).toBeTruthy());
  });
});
