import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project, SshTunnelInfo } from '@dorado/shared';
import { SshTunnelsDialog } from '../src/components/SshTunnelsDialog';
import { ToastProvider } from '../src/components/ui';
import { apiDelete, apiGet, apiPost } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiDelete: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiDelete = vi.mocked(apiDelete);

const projects: Project[] = [{ id: 'p1', name: 'web app', path: '/repo/web', createdAt: '2026-01-01' }];

const tunnel: SshTunnelInfo = {
  id: 't1',
  projectId: 'p1',
  name: 'Dev server',
  host: 'vps.example.com',
  port: 22,
  user: 'deploy',
  localPort: 13000,
  remotePort: 3000,
  status: 'running',
  createdAt: '2026-01-01'
};

describe('SshTunnelsDialog', () => {
  it('merender daftar tunnel dengan info host, port, dan status', async () => {
    mockedApiGet.mockResolvedValue({ data: [tunnel] });

    render(
      <ToastProvider>
        <SshTunnelsDialog projects={projects} isAdmin onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/Dev server/)).toBeTruthy());
    expect(screen.getByText(/deploy@vps\.example\.com:22/)).toBeTruthy();
    expect(screen.getByText(/localhost:13000/)).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('viewer melihat daftar tapi tanpa form dan aksi admin', async () => {
    mockedApiGet.mockResolvedValue({ data: [tunnel] });

    render(
      <ToastProvider>
        <SshTunnelsDialog projects={projects} isAdmin={false} onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/Dev server/)).toBeTruthy());
    expect(screen.queryByText('+ Buat Tunnel')).toBeNull();
    expect(screen.queryByText('Restart')).toBeNull();
    expect(screen.queryByText('Hapus')).toBeNull();
  });

  it('admin dapat membuat tunnel baru', async () => {
    mockedApiGet.mockResolvedValue({ data: [] });
    mockedApiPost.mockResolvedValue({
      data: { ...tunnel, name: 'API server', localPort: 13001, remotePort: 4000 }
    });

    render(
      <ToastProvider>
        <SshTunnelsDialog projects={projects} isAdmin onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('+ Buat Tunnel')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText('deploy'), { target: { value: 'deploy' } });
    fireEvent.change(screen.getByPlaceholderText('vps.example.com'), { target: { value: 'vps.example.com' } });
    fireEvent.change(screen.getByPlaceholderText('13000'), { target: { value: '13001' } });
    fireEvent.change(screen.getByPlaceholderText('3000'), { target: { value: '4000' } });
    fireEvent.click(screen.getByText('+ Buat Tunnel'));

    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/ssh-tunnels', {
        projectId: 'p1',
        name: 'deploy@vps.example.com',
        host: 'vps.example.com',
        port: 22,
        user: 'deploy',
        localPort: 13001,
        remotePort: 4000
      })
    );
  });

  it('admin dapat menghapus tunnel', async () => {
    mockedApiGet.mockResolvedValue({ data: [tunnel] });
    mockedApiDelete.mockResolvedValue({ data: { ok: true } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ToastProvider>
        <SshTunnelsDialog projects={projects} isAdmin onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/Dev server/)).toBeTruthy());
    fireEvent.click(screen.getByText('Hapus'));

    await waitFor(() => expect(mockedApiDelete).toHaveBeenCalledWith('/ssh-tunnels/t1'));
  });
});
