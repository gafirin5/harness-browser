import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentInfo, Project, Race } from '@dorado/shared';
import { RaceDialog } from '../src/components/RaceDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet, apiPost } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() };
});

const mockedGet = vi.mocked(apiGet);
const mockedPost = vi.mocked(apiPost);

const projects: Project[] = [{ id: 'p1', name: 'Proj', path: '/tmp/p', createdAt: '2026-01-01' }];
const agents: AgentInfo[] = [
  { id: 'a', name: 'Agent A', command: 'a', args: [], installed: true },
  { id: 'b', name: 'Agent B', command: 'b', args: [], installed: true },
  { id: 'c', name: 'Agent C', command: 'c', args: [], installed: false }
];

const startedRace: Race = {
  id: 'r1',
  projectId: 'p1',
  baseBranch: 'main',
  prompt: 'Fix bug',
  status: 'running',
  winnerWorktreeId: null,
  createdAt: '2026-01-01',
  entries: [
    {
      id: 'e1',
      worktreeId: 'w1',
      agentId: 'a',
      sessionId: 's1',
      branch: 'race-r1-a',
      status: 'running',
      sessionStatus: 'running',
      filesChanged: 2,
      insertions: 10,
      deletions: 3
    },
    {
      id: 'e2',
      worktreeId: 'w2',
      agentId: 'b',
      sessionId: 's2',
      branch: 'race-r1-b',
      status: 'running',
      sessionStatus: 'running',
      filesChanged: 0,
      insertions: 0,
      deletions: 0
    }
  ]
};

describe('RaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('memulai race dengan agent terpilih dan menampilkan entri', async () => {
    mockedGet.mockImplementation(() => new Promise<never>(() => undefined));
    mockedPost.mockResolvedValue({ data: startedRace });
    render(
      <ToastProvider>
        <RaceDialog projects={projects} agents={agents} onClose={() => undefined} />
      </ToastProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('mis. Perbaiki race condition pada modul auth'), {
      target: { value: 'Fix bug' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mulai Race' }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(
        '/projects/p1/races',
        expect.objectContaining({ prompt: 'Fix bug', agentIds: ['a', 'b'] })
      )
    );
    await waitFor(() => expect(screen.getByText(/race-r1-a/)).toBeTruthy());
    expect(screen.getByText(/\+10 \/ -3/)).toBeTruthy();
  });

  it('menolak memulai tanpa minimal dua agent', async () => {
    const oneInstalled: AgentInfo[] = [
      { id: 'a', name: 'Agent A', command: 'a', args: [], installed: true },
      { id: 'c', name: 'Agent C', command: 'c', args: [], installed: false }
    ];
    render(
      <ToastProvider>
        <RaceDialog projects={projects} agents={oneInstalled} onClose={() => undefined} />
      </ToastProvider>
    );
    fireEvent.change(screen.getByPlaceholderText('mis. Perbaiki race condition pada modul auth'), {
      target: { value: 'x' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mulai Race' }));
    await waitFor(() => expect(screen.getByText('Pilih minimal 2 agent.')).toBeTruthy());
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
