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
  currentVersion: '0.1.0',
  currentCommit: 'abc1234',
  currentSubject: 'init',
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

  it('menampilkan versi saat ini dan daftar commit baru', async () => {
    mockedGet.mockResolvedValue({ data: status } as never);
    renderDialog(true);

    await waitFor(() => expect(screen.getByText(/0\.1\.0/)).toBeTruthy());
    expect(screen.getByText('tambah fitur A')).toBeTruthy();
    expect(screen.getByText('perbaiki bug B')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update Sekarang' })).toBeTruthy();
  });

  it('menonaktifkan update saat working tree kotor', async () => {
    mockedGet.mockResolvedValue({ data: { ...status, dirty: true } } as never);
    renderDialog(true);

    await waitFor(() =>
      expect(screen.getByText('Working tree kotor — commit/stash dulu sebelum update.')).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: 'Update Sekarang' })).toBeDisabled();
  });

  it('menampilkan peringatan untuk viewer', async () => {
    mockedGet.mockResolvedValue({ data: status } as never);
    renderDialog(false);

    await waitFor(() => expect(screen.getByText('Hanya admin yang dapat memperbarui sistem.')).toBeTruthy());
  });
});
