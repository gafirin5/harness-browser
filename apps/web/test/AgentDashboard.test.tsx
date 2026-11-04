import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Project, SessionHistoryItem } from '@dorado/shared';
import { AgentDashboard } from '../src/components/AgentDashboard';

const project: Project = {
  id: 'p-1',
  name: 'Dorado',
  path: '/tmp/dorado',
  createdAt: '2026-11-01T00:00:00.000Z'
};

function makeSession(
  id: string,
  status: SessionHistoryItem['status'],
  title: string,
  created: string
): SessionHistoryItem {
  return {
    id,
    worktreeId: 'wt-1',
    terminalId: `t-${id}`,
    agent: 'opencode',
    title,
    prompt: '',
    status,
    exitCode: null,
    createdAt: created,
    startedAt: created,
    endedAt: status === 'running' ? null : created,
    projectId: 'p-1',
    projectName: 'Dorado',
    worktreeBranch: 'main',
    worktreePath: '/tmp/dorado/worktrees/main'
  };
}

const sessions: SessionHistoryItem[] = [
  makeSession('1', 'running', 'Sedang bekerja', '2026-11-05T10:00:00.000Z'),
  makeSession('2', 'failed', 'Butuh perhatian', '2026-11-05T09:00:00.000Z'),
  makeSession('3', 'completed', 'Sudah selesai', '2026-11-05T08:00:00.000Z'),
  makeSession('4', 'stopped', 'Dihentikan', '2026-11-05T07:00:00.000Z')
];

const baseProps = {
  sessions,
  loading: false,
  projects: [project],
  selectedProjectId: 'p-1',
  inboxRead: [] as string[],
  onClose: () => undefined,
  onRefresh: () => undefined,
  onOpenSession: () => undefined,
  onRerun: () => undefined,
  onStop: () => undefined,
  onMarkRead: () => undefined,
  onMarkAllRead: () => undefined
};

describe('AgentDashboard', () => {
  it('mengelompokkan sesi ke kolom board', () => {
    render(<AgentDashboard {...baseProps} />);
    expect(screen.getByText('Needs You')).toBeTruthy();
    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('Butuh perhatian')).toBeTruthy();
    expect(screen.getByText('Sedang bekerja')).toBeTruthy();
    expect(screen.getByText('Sudah selesai')).toBeTruthy();
    expect(screen.getByText('Dihentikan')).toBeTruthy();
  });

  it('membuka sesi dan menandainya dibaca', () => {
    const onOpenSession = vi.fn();
    const onMarkRead = vi.fn();
    render(<AgentDashboard {...baseProps} onOpenSession={onOpenSession} onMarkRead={onMarkRead} />);

    const card = screen.getByText('Butuh perhatian').closest('.dashboard-card');
    const openButton = Array.from(card?.querySelectorAll('button') ?? []).find(
      (item) => (item.textContent || '').trim() === 'Buka'
    );
    fireEvent.click(openButton as HTMLButtonElement);

    expect(onMarkRead).toHaveBeenCalledWith('2');
    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
  });

  it('menampilkan inbox dengan hitungan belum dibaca', () => {
    render(<AgentDashboard {...baseProps} initialTab="inbox" inboxRead={['3']} />);
    expect(screen.getByText('Inbox (1)')).toBeTruthy();
    expect(document.querySelectorAll('.dashboard-inbox-row.unread')).toHaveLength(1);

    fireEvent.click(screen.getByText('Tandai Semua Dibaca'));
  });
});
