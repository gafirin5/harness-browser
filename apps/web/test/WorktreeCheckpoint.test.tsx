import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Worktree } from '@dorado/shared';
import { WorktreeCheckpoint, checkpointLabel } from '../src/components/WorktreeCheckpoint';
import { ToastProvider } from '../src/components/ui';
import { apiPatch } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiPatch: vi.fn()
  };
});

const mockedApiPatch = vi.mocked(apiPatch);

const worktree: Worktree = {
  id: 'wt-1',
  projectId: 'p-1',
  branch: 'agent/checkpoint',
  path: '/tmp/dorado/worktrees/checkpoint',
  baseRef: 'main',
  status: 'ready',
  taskStatus: 'todo',
  note: '',
  createdAt: '2026-11-05T00:00:00.000Z'
};

describe('WorktreeCheckpoint', () => {
  it('menyimpan perubahan status saat select berubah', async () => {
    mockedApiPatch.mockResolvedValue({
      data: { ...worktree, taskStatus: 'in-review', note: '' }
    });
    const onUpdated = vi.fn();

    render(
      <ToastProvider>
        <WorktreeCheckpoint worktree={worktree} onUpdated={onUpdated} />
      </ToastProvider>
    );

    fireEvent.change(screen.getByLabelText('Checkpoint agent/checkpoint'), {
      target: { value: 'in-review' }
    });

    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/worktrees/wt-1', {
        taskStatus: 'in-review',
        note: ''
      })
    );
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ taskStatus: 'in-review' }));
  });

  it('menyimpan catatan lewat tombol', async () => {
    mockedApiPatch.mockResolvedValue({
      data: { ...worktree, note: 'Catatan baru' }
    });
    const onUpdated = vi.fn();

    render(
      <ToastProvider>
        <WorktreeCheckpoint worktree={worktree} onUpdated={onUpdated} />
      </ToastProvider>
    );

    fireEvent.change(screen.getByLabelText('Catatan checkpoint agent/checkpoint'), {
      target: { value: 'Catatan baru' }
    });
    fireEvent.click(screen.getByText('Simpan Catatan'));

    await waitFor(() =>
      expect(mockedApiPatch).toHaveBeenCalledWith('/worktrees/wt-1', {
        taskStatus: 'todo',
        note: 'Catatan baru'
      })
    );
  });

  it('memberi label checkpoint yang ramah', () => {
    expect(checkpointLabel('in-progress')).toBe('In progress');
    expect(checkpointLabel('completed')).toBe('Completed');
  });
});
