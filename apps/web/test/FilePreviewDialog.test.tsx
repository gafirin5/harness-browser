import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Worktree } from '@dorado/shared';
import { FilePreviewDialog } from '../src/components/FilePreviewDialog';
import { ToastProvider } from '../src/components/ui';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(() => Promise.resolve({ data: { content: '', binary: false } })),
    apiPost: vi.fn()
  };
});

const worktrees: Worktree[] = [
  {
    id: 'w1',
    projectId: 'p1',
    branch: 'feat-preview',
    path: '/tmp/w',
    baseRef: 'main',
    status: 'ready',
    taskStatus: 'todo',
    note: '',
    createdAt: '2026-01-01'
  }
];

describe('FilePreviewDialog', () => {
  it('menampilkan input worktree/path dan pesan untuk tipe tak didukung', async () => {
    render(
      <ToastProvider>
        <FilePreviewDialog
          worktrees={worktrees}
          selectedWorktreeId="w1"
          activeTerminalId={null}
          onClose={() => undefined}
        />
      </ToastProvider>
    );
    expect(screen.getByText('Path file')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('docs/spec.pdf atau data.csv'), { target: { value: 'note.bin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Muat' }));
    await waitFor(() => expect(screen.getByText('Tipe file ini belum didukung untuk pratinjau.')).toBeTruthy());
  });
});
