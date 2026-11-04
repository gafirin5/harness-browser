import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Automation, Project, Worktree } from '@dorado/shared';
import { AutomationsDialog } from '../src/components/AutomationsDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet, apiPost } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const project: Project = {
  id: 'p-1',
  name: 'Dorado',
  path: '/tmp/dorado',
  createdAt: '2026-11-01T00:00:00.000Z'
};

const worktree: Worktree = {
  id: 'wt-1',
  projectId: 'p-1',
  branch: 'main',
  path: '/tmp/dorado/worktrees/main',
  baseRef: 'main',
  status: 'ready',
  taskStatus: 'todo',
  note: '',
  createdAt: '2026-11-01T00:00:00.000Z'
};

const automation: Automation = {
  id: 'a-1',
  projectId: 'p-1',
  worktreeId: 'wt-1',
  name: 'Cek malam',
  schedule: 'manual',
  prompt: 'Cek kondisi repo',
  agent: 'opencode',
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: '2026-11-01T00:00:00.000Z'
};

describe('AutomationsDialog', () => {
  it('menampilkan otomasi dan menjalankannya manual', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') {
        return { data: [{ id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], installed: true }] };
      }
      return { data: [automation] };
    });
    mockedApiPost.mockResolvedValue({ data: { ok: true, sessionId: 's-1' } });

    const onRan = vi.fn();
    render(
      <ToastProvider>
        <AutomationsDialog project={project} worktrees={[worktree]} onClose={() => undefined} onRan={onRan} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Cek malam')).toBeTruthy());
    expect(screen.getByText('Cek kondisi repo')).toBeTruthy();
    fireEvent.click(screen.getByText('Run'));

    await waitFor(() => expect(mockedApiPost).toHaveBeenCalledWith('/automations/a-1/run'));
    expect(onRan).toHaveBeenCalled();
  });

  it('menampilkan pesan saat belum ada otomasi', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/agents') return { data: [] };
      return { data: [] };
    });

    render(
      <ToastProvider>
        <AutomationsDialog project={project} worktrees={[worktree]} onClose={() => undefined} onRan={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Belum ada otomasi.')).toBeTruthy());
  });
});
