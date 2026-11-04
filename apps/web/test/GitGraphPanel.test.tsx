import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '@dorado/shared';
import { GitGraphPanel } from '../src/components/GitGraphPanel';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

const project: Project = {
  id: 'p-1',
  name: 'Dorado',
  path: '/tmp/dorado',
  createdAt: '2026-11-01T00:00:00.000Z'
};

describe('GitGraphPanel', () => {
  it('merender commit, lane, dan detail saat diklik', async () => {
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/git/graph/commit')) {
        return {
          data: {
            hash: 'b'.repeat(40),
            shortHash: 'bbbbbbb',
            author: 'Ana',
            email: 'ana@example.com',
            timestamp: 1700000200,
            subject: 'Perbaiki graph',
            body: 'Detail body',
            files: [{ path: 'src/graph.ts', status: 'M' }]
          }
        };
      }
      return {
        data: {
          commits: [
            {
              hash: 'a'.repeat(40),
              shortHash: 'aaaaaaa',
              parents: ['b'.repeat(40)],
              author: 'Ana',
              email: 'ana@example.com',
              timestamp: 1700000300,
              subject: 'Merge branch',
              refs: ['main'],
              lane: 0
            },
            {
              hash: 'b'.repeat(40),
              shortHash: 'bbbbbbb',
              parents: [],
              author: 'Budi',
              email: 'budi@example.com',
              timestamp: 1700000200,
              subject: 'Perbaiki graph',
              refs: [],
              lane: 1
            }
          ],
          edges: [{ from: 0, to: 1, fromLane: 0, toLane: 1 }],
          maxLane: 1,
          truncated: false
        }
      };
    });

    const onClose = vi.fn();
    render(<GitGraphPanel project={project} onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('Merge branch')).toBeTruthy());
    expect(screen.getByText('main')).toBeTruthy();
    expect(document.querySelectorAll('.git-graph-svg path')).toHaveLength(1);

    fireEvent.click(screen.getByText('Perbaiki graph'));
    await waitFor(() => expect(screen.getByText('Detail body')).toBeTruthy());
    expect(screen.getByText('src/graph.ts')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Tutup'));
    expect(onClose).toHaveBeenCalled();
  });

  it('meminta project dipilih saat project null', () => {
    render(<GitGraphPanel project={null} onClose={() => undefined} />);
    expect(screen.getByText('Pilih project terlebih dahulu.')).toBeTruthy();
  });
});
