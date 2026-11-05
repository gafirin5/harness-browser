import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionHistoryItem } from '@dorado/shared';
import { HistoryDialog } from '../src/components/HistoryDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

const item: SessionHistoryItem = {
  id: 'session-123456',
  worktreeId: 'wt-1',
  terminalId: 't-1',
  agent: 'opencode',
  title: 'Perbaiki graph',
  prompt: 'Tolong perbaiki lane graph.',
  status: 'completed',
  exitCode: 0,
  createdAt: '2026-11-05T01:00:00.000Z',
  startedAt: '2026-11-05T01:00:00.000Z',
  endedAt: '2026-11-05T01:05:00.000Z',
  projectId: 'p-1',
  projectName: 'Dorado',
  worktreeBranch: 'main',
  worktreePath: '/tmp/dorado/worktrees/main'
};

describe('HistoryDialog', () => {
  it('menampilkan scope, path worktree, dan perintah resume', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') {
        return {
          data: [
            {
              id: 'opencode',
              name: 'OpenCode',
              command: 'opencode',
              args: ['--prompt', '{{prompt}}'],
              resumeArgs: ['--continue', '--prompt', '{{prompt}}'],
              installed: true
            }
          ]
        };
      }
      return { data: [item], meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
    });

    render(
      <ToastProvider>
        <HistoryDialog
          onClose={() => undefined}
          onRerun={async () => undefined}
          onDelete={async () => true}
          onPurge={async () => 0}
          selectedProjectId="p-1"
          selectedWorktreeId={null}
        />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Perbaiki graph')).toBeTruthy());
    expect(screen.getByText('/tmp/dorado/worktrees/main')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('opencode --continue')).toBeTruthy());
    expect(screen.getByText('↻ Restart Sesi')).toBeTruthy();

    const scope = screen.getByLabelText('Scope riwayat') as HTMLSelectElement;
    expect(scope.value).toBe('project');

    fireEvent.change(screen.getByLabelText('Kelompok riwayat'), { target: { value: 'agent' } });
    expect(document.querySelectorAll('.history-group .section-label')).toHaveLength(1);
  });

  it('menghapus sesi terpilih setelah konfirmasi handler', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') {
        return {
          data: [
            {
              id: 'opencode',
              name: 'OpenCode',
              command: 'opencode',
              args: ['--prompt', '{{prompt}}'],
              installed: true
            }
          ]
        };
      }
      return { data: [item], meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
    });
    const onDelete = vi.fn(async () => true);

    render(
      <ToastProvider>
        <HistoryDialog
          onClose={() => undefined}
          onRerun={async () => undefined}
          onDelete={onDelete}
          onPurge={async () => 0}
          selectedProjectId="p-1"
          selectedWorktreeId={null}
        />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Perbaiki graph')).toBeTruthy());
    fireEvent.click(screen.getByText('Hapus Sesi'));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-123456' })));
    await waitFor(() => expect(screen.queryByText('Perbaiki graph')).toBeNull());
    expect(screen.getByText('Belum ada sesi yang cocok.')).toBeTruthy();
  });

  it('mencari transcript sesi', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') return { data: [] };
      if (path.startsWith('/sessions/session-123456/transcript')) {
        return { data: { available: true, total: 1, truncated: false, lines: [{ line: 3, text: 'mock-start' }] } };
      }
      return { data: [item], meta: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
    });

    render(
      <ToastProvider>
        <HistoryDialog
          onClose={() => undefined}
          onRerun={async () => undefined}
          onDelete={async () => true}
          onPurge={async () => 0}
          selectedProjectId="p-1"
          selectedWorktreeId={null}
        />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Perbaiki graph')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Cari transcript sesi'), { target: { value: 'mock-start' } });
    const transcriptForm = screen.getByLabelText('Cari transcript sesi').closest('form');
    if (transcriptForm) fireEvent.submit(transcriptForm);

    await waitFor(() => expect(screen.getByText('mock-start')).toBeTruthy());
    expect(mockedApiGet).toHaveBeenCalledWith('/sessions/session-123456/transcript?q=mock-start&limit=200');
  });
});
