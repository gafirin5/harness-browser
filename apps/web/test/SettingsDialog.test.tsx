import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderDialog(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <SettingsDialog onClose={() => undefined} />
    </ToastProvider>
  );
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('menolak konfirmasi password yang berbeda tanpa memanggil API', async () => {
    const user = userEvent.setup();
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Pengaturan Keamanan' });
    const inputs = dialog.querySelectorAll('input');
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'password-lama' } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'password-baru-123' } });
    fireEvent.change(inputs[2] as HTMLInputElement, { target: { value: 'password-beda-123' } });
    await user.click(screen.getByRole('button', { name: 'Simpan Password' }));

    expect(screen.getByText('Konfirmasi password tidak sama.')).toBeInTheDocument();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('mengirim permintaan ganti password dan menampilkan toast', async () => {
    mockedRequest.mockResolvedValue({ data: { revokedSessions: 2 } });
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
});
