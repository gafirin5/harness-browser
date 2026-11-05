import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DiffComment } from '@dorado/shared';
import { DiffViewer, parseDiffLines } from '../src/components/DiffViewer';
import { ToastProvider } from '../src/components/ui';
import { apiGet, apiPatch, apiPost } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPatch: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);
const mockedApiPatch = vi.mocked(apiPatch);

const diff = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' # e2e',
  '+baris baru'
].join('\n');

describe('parseDiffLines', () => {
  it('menomori baris baru dan mengabaikan baris yang dihapus', () => {
    const lines = parseDiffLines(diff);
    const context = lines.find((line) => line.text === ' # e2e');
    const added = lines.find((line) => line.text === '+baris baru');
    const removed = lines.find((line) => line.text.startsWith('---'));
    expect(context?.newLine).toBe(1);
    expect(added?.newLine).toBe(2);
    expect(removed?.newLine).toBeNull();
  });
});

const comment: DiffComment = {
  id: 'c-1',
  worktreeId: 'wt-1',
  path: 'README.md',
  line: 2,
  body: 'Tolong perjelas baris ini.',
  createdAt: '2026-11-05T00:00:00.000Z',
  resolvedAt: null
};

describe('DiffViewer annotate', () => {
  it('menyimpan komentar baris lalu mengirimkannya ke agent', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/git/diff')) return { data: { diff, truncated: false } };
      if (path.startsWith('/review')) {
        return { data: path.includes('path=') ? [] : [comment] };
      }
      if (path === '/agents') {
        return {
          data: [{ id: 'opencode', name: 'OpenCode', command: 'opencode', args: [], installed: true }]
        };
      }
      return { data: [] };
    });
    mockedApiPost.mockImplementation(async (path: string) => {
      if (path === '/review') return { data: comment };
      return {
        data: {
          id: 's-1',
          worktreeId: 'wt-1',
          terminalId: 't-1',
          agent: 'opencode',
          title: 'Review README.md',
          prompt: 'prompt',
          status: 'running',
          exitCode: null,
          createdAt: '2026-11-05T00:00:00.000Z',
          startedAt: '2026-11-05T00:00:00.000Z',
          endedAt: null
        }
      };
    });

    const onSessionStarted = vi.fn();
    const { container } = render(
      <ToastProvider>
        <DiffViewer worktreeId="wt-1" filePath="README.md" initialStaged={false} onSessionStarted={onSessionStarted} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('+baris baru')).toBeTruthy());
    const lineButton = Array.from(container.querySelectorAll('.diff-line-no')).find(
      (element) => (element.textContent || '').trim() === '2'
    ) as HTMLButtonElement;
    fireEvent.click(lineButton);

    const textarea = await screen.findByPlaceholderText('Tulis komentar untuk baris ini...');
    fireEvent.change(textarea, { target: { value: 'Tolong perjelas baris ini.' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('Tolong perjelas baris ini.')).toBeTruthy());
    expect(mockedApiPost).toHaveBeenCalledWith('/review', {
      worktreeId: 'wt-1',
      path: 'README.md',
      line: 2,
      body: 'Tolong perjelas baris ini.'
    });

    fireEvent.click(screen.getByText('Kirim ke Agent'));
    await waitFor(() => expect(screen.getByText('Kirim Komentar ke Agent')).toBeTruthy());
    await waitFor(() => expect((screen.getByText('Jalankan Agent') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Jalankan Agent'));

    await waitFor(() => expect(onSessionStarted).toHaveBeenCalled());
    const sessionCall = mockedApiPost.mock.calls.find((call) => call[0] === '/sessions');
    expect(sessionCall?.[1]).toEqual(
      expect.objectContaining({
        worktreeId: 'wt-1',
        agent: 'opencode',
        prompt: expect.stringContaining('Baris 2: Tolong perjelas baris ini.')
      })
    );
  });

  it('resolve dan reopen komentar lewat API', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/git/diff')) return { data: { diff, truncated: false } };
      if (path.startsWith('/review')) return { data: [comment] };
      return { data: [] };
    });
    mockedApiPatch.mockResolvedValue({
      data: { ...comment, resolvedAt: '2026-11-05T01:00:00.000Z' }
    });

    render(
      <ToastProvider>
        <DiffViewer worktreeId="wt-1" filePath="README.md" initialStaged={false} />
      </ToastProvider>
    );

    await waitFor(() => expect(screen.getByText('Tolong perjelas baris ini.')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Tandai komentar baris 2 selesai'));

    await waitFor(() => expect(mockedApiPatch).toHaveBeenCalledWith('/review/c-1', { resolved: true }));
    await waitFor(() => expect(screen.getByLabelText('Buka kembali komentar baris 2')).toBeTruthy());
    expect(document.querySelector('.diff-comment.resolved')).toBeTruthy();
  });
});
