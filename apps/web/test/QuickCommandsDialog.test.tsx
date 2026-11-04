import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project, TerminalInfo } from '@dorado/shared';
import { QuickCommandsDialog } from '../src/components/QuickCommandsDialog';
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

const terminal: TerminalInfo = {
  id: 't-1',
  worktreeId: 'wt-1',
  title: 'Terminal 1',
  kind: 'shell',
  status: 'running',
  cols: 120,
  rows: 32,
  exitCode: null,
  createdAt: '2026-11-01T00:00:00.000Z'
};

describe('QuickCommandsDialog', () => {
  it('menampilkan command dan menjalankannya di terminal aktif', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          id: 'qc-1',
          scope: 'project',
          projectId: 'p-1',
          label: 'Test cepat',
          command: 'npm test',
          createdAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    });
    mockedApiPost.mockResolvedValue({ data: { ok: true } });

    render(
      <ToastProvider>
        <QuickCommandsDialog project={project} activeTerminal={terminal} onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Test cepat')).toBeTruthy());
    expect(screen.getByText('npm test')).toBeTruthy();
    fireEvent.click(screen.getByText('Run'));

    await waitFor(() => expect(mockedApiPost).toHaveBeenCalledWith('/terminals/t-1/input', { data: 'npm test\r' }));
  });

  it('menonaktifkan Run saat tidak ada terminal aktif', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          id: 'qc-2',
          scope: 'global',
          projectId: null,
          label: 'Build',
          command: 'npm run build',
          createdAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    });

    render(
      <ToastProvider>
        <QuickCommandsDialog project={project} activeTerminal={null} onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Build')).toBeTruthy());
    const run = screen.getByText('Run') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });
});
