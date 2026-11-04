import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuditDialog } from '../src/components/AuditDialog';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

describe('AuditDialog', () => {
  it('menampilkan entri audit dengan label aksi', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        {
          id: 1,
          userId: 1,
          username: 'admin',
          action: 'LOGIN',
          targetType: null,
          targetId: null,
          detail: 'Password',
          ip: '127.0.0.1',
          createdAt: '2026-11-04T00:00:00.000Z'
        },
        {
          id: 2,
          userId: 1,
          username: 'admin',
          action: 'USER_CREATE',
          targetType: 'user',
          targetId: '2',
          detail: 'viewer (VIEWER)',
          ip: '127.0.0.1',
          createdAt: '2026-11-04T00:01:00.000Z'
        }
      ],
      meta: { total: 2 }
    } as never);

    render(<AuditDialog onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Audit Log' })).toBeInTheDocument();
    expect(await screen.findAllByText('admin')).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(within(table).getByText('Login')).toBeInTheDocument();
    expect(within(table).getByText('User dibuat')).toBeInTheDocument();
    expect(within(table).getByText('user:2')).toBeInTheDocument();
    expect(screen.getByText('Menampilkan 2 dari 2 entri.')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/audit?limit=200');
  });
});
