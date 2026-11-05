import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GitHubDialog } from '../src/components/GitHubDialog';
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

describe('GitHubDialog write actions', () => {
  it('mengirim komentar pull request dan merge lewat API', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/github/info')) {
        return {
          data: {
            connected: true,
            remote: 'git@github.com:dorado/dorado.git',
            ref: { owner: 'dorado', repo: 'dorado' },
            repo: {
              fullName: 'dorado/dorado',
              description: 'Test',
              htmlUrl: 'https://github.com/dorado/dorado',
              defaultBranch: 'main',
              openIssuesCount: 1,
              stars: 1,
              private: false
            }
          }
        };
      }
      if (path.startsWith('/github/pulls')) {
        return {
          data: [
            {
              number: 7,
              title: 'Perbaiki graph',
              state: 'open',
              draft: false,
              htmlUrl: 'https://github.com/dorado/dorado/pull/7',
              author: 'ana',
              head: 'agent/graph',
              base: 'main',
              updatedAt: '2026-11-05T00:00:00.000Z'
            }
          ]
        };
      }
      if (path.startsWith('/github/thread')) {
        return { data: { comments: [], reviews: [] } };
      }
      return { data: [] };
    });
    mockedApiPost.mockResolvedValue({ data: { ok: true } });

    render(
      <ToastProvider>
        <GitHubDialog worktreeId="wt-1" onClose={() => undefined} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Perbaiki graph')).toBeTruthy());

    fireEvent.click(screen.getByText('Komentar'));
    const textarea = await screen.findByPlaceholderText('Tulis komentar untuk #7...');
    fireEvent.change(textarea, { target: { value: 'Mohon tambah test.' } });
    fireEvent.click(screen.getByText('Kirim Komentar'));

    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/github/comment', {
        worktreeId: 'wt-1',
        number: 7,
        body: 'Mohon tambah test.',
        kind: 'pull'
      })
    );

    fireEvent.click(screen.getByText('Merge'));
    await waitFor(() => expect(screen.getByText('Merge Sekarang')).toBeTruthy());
    fireEvent.click(screen.getByText('Merge Sekarang'));

    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/github/merge', {
        worktreeId: 'wt-1',
        number: 7,
        method: 'squash'
      })
    );

    fireEvent.click(screen.getByText('Label'));
    const labelsInput = await screen.findByLabelText('Label GitHub');
    fireEvent.change(labelsInput, { target: { value: 'bug, ui' } });
    fireEvent.click(screen.getByText('Simpan Label'));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/github/labels', {
        worktreeId: 'wt-1',
        number: 7,
        labels: ['bug', 'ui']
      })
    );

    fireEvent.click(screen.getByText('Diskusi'));
    await waitFor(() => expect(screen.getByText('Belum ada komentar atau review.')).toBeTruthy());
  });
});
