import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserInfo } from '@dorado/shared';
import { ToastProvider } from '../src/components/ui';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { request } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    request: vi.fn()
  };
});

const mockedRequest = vi.mocked(request);

const adminUser: UserInfo = {
  id: 1,
  username: 'admin',
  name: 'Admin',
  role: 'ADMIN',
  isActive: true,
  totpEnabled: false
};

function renderDialog(currentUser: UserInfo = adminUser): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <SettingsDialog onClose={() => undefined} currentUser={currentUser} />
    </ToastProvider>
  );
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedRequest.mockImplementation((async (path: string) => {
      if (path === '/users') return { data: [] };
      if (path === '/auth/2fa/setup') {
        return {
          data: {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUrl: 'otpauth://totp/Dorado:admin?secret=JBSWY3DPEHPK3PXP',
            qrDataUrl: 'data:image/png;base64,AAAA'
          }
        };
      }
      if (path === '/auth/2fa/confirm') return { data: { enabled: true } };
      return { data: { revokedSessions: 2 } };
    }) as never);
  });

  it('menolak konfirmasi password yang berbeda tanpa memanggil API password', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Pengaturan Keamanan' });
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'password-lama' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'password-baru-123' } });
    fireEvent.change(inputs[2] as HTMLInputElement, { target: { value: 'password-beda-123' } });
    await user.click(screen.getByRole('button', { name: 'Simpan Password' }));

    expect(screen.getByText('Konfirmasi password tidak sama.')).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalledWith('/auth/password', expect.anything());
  });

  it('mengirim permintaan ganti password dan menampilkan toast', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Pengaturan Keamanan' });
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'password-lama' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'password-baru-123' } });
    fireEvent.change(inputs[2] as HTMLInputElement, { target: { value: 'password-baru-123' } });
    await user.click(screen.getByRole('button', { name: 'Simpan Password' }));

    expect(mockedRequest).toHaveBeenCalledWith('/auth/password', {
      method: 'PATCH',
      body: { currentPassword: 'password-lama', newPassword: 'password-baru-123' }
    });
    expect(await screen.findByText('Password diperbarui. 2 sesi lain dicabut.')).toBeInTheDocument();
  });

  it('menampilkan mode viewer tanpa form pengguna', () => {
    renderDialog({ ...adminUser, id: 2, username: 'viewer', role: 'VIEWER' });
    expect(screen.getByText('Mode viewer: pengelolaan user hanya tersedia untuk admin.')).toBeInTheDocument();
  });

  it('menyiapkan dan mengonfirmasi 2FA', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Aktifkan 2FA' }));
    expect(await screen.findByAltText('QR 2FA')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Kode konfirmasi 2FA'), { target: { value: '123456' } });
    await user.click(screen.getByRole('button', { name: 'Konfirmasi 2FA' }));
    expect(await screen.findByText('2FA berhasil diaktifkan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nonaktifkan 2FA' })).toBeInTheDocument();
  });
});
