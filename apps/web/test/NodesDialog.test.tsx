import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RemoteNodeInfo, UserInfo } from '@dorado/shared';
import { NodesDialog } from '../src/components/NodesDialog';
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

const adminUser: UserInfo = {
  id: 1,
  username: 'admin',
  name: 'Admin',
  role: 'ADMIN',
  isActive: true,
  totpEnabled: false
};

const viewerUser: UserInfo = {
  id: 2,
  username: 'viewer',
  name: 'Viewer',
  role: 'VIEWER',
  isActive: true,
  totpEnabled: false
};

const mockNodes: RemoteNodeInfo[] = [
  {
    id: 'node-1',
    name: 'Server GPU 1',
    status: 'online',
    hostname: 'gpu-server-01',
    platform: 'linux (x64)',
    agents: [{ id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], installed: true }],
    latencyMs: 42,
    lastSeenAt: '2026-11-06T00:00:00.000Z',
    createdAt: '2026-11-05T00:00:00.000Z'
  },
  {
    id: 'node-2',
    name: 'MacBook M3',
    status: 'offline',
    hostname: 'macbook.local',
    platform: 'darwin (arm64)',
    agents: [],
    latencyMs: null,
    lastSeenAt: null,
    createdAt: '2026-11-05T01:00:00.000Z'
  }
];

describe('NodesDialog', () => {
  it('merender daftar node remote dan local controller host', async () => {
    mockedApiGet.mockResolvedValue({ data: mockNodes });
    const onSelectNode = vi.fn();
    const onClose = vi.fn();

    render(
      <ToastProvider>
        <NodesDialog currentUser={adminUser} activeNodeId={null} onSelectNode={onSelectNode} onClose={onClose} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/Server GPU 1/)).toBeTruthy());
    expect(screen.getByText(/Local/)).toBeTruthy();
    expect(screen.getByText(/42 ms/)).toBeTruthy();
    expect(screen.getByText(/MacBook M3/)).toBeTruthy();
    expect(screen.getByText('offline')).toBeTruthy();

    fireEvent.click(screen.getByText('Tutup'));
    expect(onClose).toHaveBeenCalled();
  });

  it('admin dapat mendaftarkan node baru dan melihat perintah pairing', async () => {
    mockedApiGet.mockResolvedValue({ data: [] });
    mockedApiPost.mockResolvedValue({
      data: {
        id: 'node-new',
        name: 'Node Baru',
        status: 'offline',
        hostname: null,
        platform: null,
        agents: [],
        latencyMs: null,
        lastSeenAt: null,
        createdAt: '2026-11-06T00:00:00.000Z',
        token: 'dnode_secret_token_123',
        pairCommand: 'DORADO_NODE_TOKEN="dnode_secret_token_123" npm run node'
      }
    });

    render(
      <ToastProvider>
        <NodesDialog
          currentUser={adminUser}
          activeNodeId={null}
          onSelectNode={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    const input = screen.getByLabelText('Nama node baru');
    fireEvent.change(input, { target: { value: 'Node Baru' } });
    fireEvent.click(screen.getByText('+ Tambah Node'));

    await waitFor(() => expect(screen.getByText(/Token Node Baru: Node Baru/)).toBeTruthy());
    expect(screen.getByText(/dnode_secret_token_123/)).toBeTruthy();
  });

  it('viewer tidak melihat form tambah node dan tombol aksi admin', async () => {
    mockedApiGet.mockResolvedValue({ data: mockNodes });

    render(
      <ToastProvider>
        <NodesDialog
          currentUser={viewerUser}
          activeNodeId={null}
          onSelectNode={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText(/Server GPU 1/)).toBeTruthy());
    expect(screen.queryByLabelText('Nama node baru')).toBeNull();
    expect(screen.queryByText('Token Baru')).toBeNull();
    expect(screen.queryByText('Hapus')).toBeNull();
  });

  it('admin dapat menghapus node', async () => {
    mockedApiGet.mockResolvedValue({ data: mockNodes });
    mockedApiDelete.mockResolvedValue({ data: { ok: true } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <ToastProvider>
        <NodesDialog
          currentUser={adminUser}
          activeNodeId={'node-1'}
          onSelectNode={() => undefined}
          onClose={() => undefined}
        />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getAllByText('Hapus').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Hapus')[0]!);

    await waitFor(() => expect(mockedApiDelete).toHaveBeenCalledWith('/nodes/node-1'));
  });
});
