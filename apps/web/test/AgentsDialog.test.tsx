import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentsDialog } from '../src/components/AgentsDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet, apiPost } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() };
});

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

function mockAgents(data: unknown[]): void {
  mockedApiGet.mockImplementation(((path: string) =>
    Promise.resolve(path === '/profiles' ? { data: [] } : { data })) as never);
}

function renderDialog(isAdmin: boolean): void {
  render(
    <ToastProvider>
      <AgentsDialog isAdmin={isAdmin} onClose={() => undefined} />
    </ToastProvider>
  );
}

describe('AgentsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('menampilkan preset bawaan dan agent kustom dengan aksi berbeda', async () => {
    mockAgents([
      {
        id: 'opencode',
        name: 'OpenCode',
        command: 'opencode',
        args: ['--prompt', '{{prompt}}'],
        installed: true,
        source: 'builtin',
        builtin: true
      },
      { id: 'mine', name: 'Mine', command: 'mine', args: [], installed: false, source: 'custom' }
    ]);
    renderDialog(true);

    await waitFor(() => expect(screen.getAllByText('OpenCode').length).toBeGreaterThan(0));
    expect(screen.getByText('Bawaan')).toBeTruthy();
    expect(screen.getByText('Kustom')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Override' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hapus' })).toBeTruthy();
  });

  it('tombol Override mengisi form dengan nilai agent', async () => {
    mockAgents([
      {
        id: 'claude',
        name: 'Claude Code',
        command: 'claude',
        args: ['-p', '{{prompt}}'],
        resumeArgs: ['-c', '-p', '{{prompt}}'],
        interactiveArgs: [],
        installed: true,
        source: 'builtin',
        builtin: true
      }
    ]);
    renderDialog(true);

    await waitFor(() => expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Override' }));

    expect(screen.getByPlaceholderText('mis. claude')).toHaveValue('claude');
    expect(screen.getByPlaceholderText('Nama tampilan')).toHaveValue('Claude Code');
    expect(screen.getByPlaceholderText('mis. my-agent')).toHaveValue('claude');
  });

  it('menambah agent kustom memanggil API POST', async () => {
    mockAgents([]);
    mockedApiPost.mockResolvedValue({
      data: { id: 'mine', name: 'Mine', command: 'mine', args: [], installed: false, source: 'custom' }
    });
    renderDialog(true);

    await waitFor(() => expect(screen.getByText('Belum ada agent.')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('mis. claude'), { target: { value: 'mine' } });
    fireEvent.change(screen.getByPlaceholderText('Nama tampilan'), { target: { value: 'Mine' } });
    fireEvent.change(screen.getByPlaceholderText('mis. my-agent'), { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Tambah Agent' }));

    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(
        '/agents',
        expect.objectContaining({ id: 'mine', name: 'Mine', command: 'mine' })
      )
    );
  });

  it('viewer tidak melihat form pengelolaan', async () => {
    mockAgents([
      {
        id: 'opencode',
        name: 'OpenCode',
        command: 'opencode',
        args: [],
        installed: true,
        source: 'builtin',
        builtin: true
      }
    ]);
    renderDialog(false);

    await waitFor(() => expect(screen.getAllByText('OpenCode').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: '+ Tambah Agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Override' })).toBeNull();
    expect(screen.getByText('Hanya admin yang dapat menambah atau mengubah agent.')).toBeTruthy();
  });
});
