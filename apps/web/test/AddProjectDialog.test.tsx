import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddProjectDialog } from '../src/components/Dialogs';
import { ToastProvider } from '../src/components/ui';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

describe('AddProjectDialog discover', () => {
  it('memindai repository dan mengisi path+name saat kandidat dipilih', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        { path: '/home/user/projects/dorado', name: 'dorado', branch: 'main' },
        { path: '/home/user/projects/app', name: 'app', branch: 'develop' }
      ],
      meta: { total: 2, truncated: false }
    });

    render(
      <ToastProvider>
        <AddProjectDialog onClose={() => undefined} onCreated={() => undefined} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('🔍 Pindai Repository'));

    await waitFor(() => expect(screen.getByRole('button', { name: /dorado/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /app/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dorado/ }));

    const pathInput = screen.getByPlaceholderText('/home/user/projects/app');
    const nameInput = screen.getByDisplayValue('dorado');
    expect(pathInput).toHaveValue('/home/user/projects/dorado');
    expect(nameInput).toBeTruthy();
  });

  it('memfilter kandidat saat pengguna mengetik query', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        { path: '/home/user/projects/dorado', name: 'dorado', branch: 'main' },
        { path: '/home/user/projects/app', name: 'app', branch: 'main' }
      ],
      meta: { total: 2, truncated: false }
    });

    render(
      <ToastProvider>
        <AddProjectDialog onClose={() => undefined} onCreated={() => undefined} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('🔍 Pindai Repository'));
    await waitFor(() => expect(screen.getByRole('button', { name: /dorado/ })).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Filter repository'), { target: { value: 'app' } });

    await waitFor(() => expect(screen.queryByRole('button', { name: /dorado/ })).toBeNull());
    expect(screen.getByRole('button', { name: /app/ })).toBeTruthy();
  });
});
