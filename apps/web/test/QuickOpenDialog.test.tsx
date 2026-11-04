import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickOpenDialog } from '../src/components/QuickOpenDialog';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

describe('QuickOpenDialog', () => {
  it('mencari file lewat endpoint /files/find dan membuka hasil', async () => {
    mockedApiGet.mockResolvedValue({
      data: [
        { path: 'src/app.tsx', name: 'app.tsx', dir: 'src' },
        { path: 'README.md', name: 'README.md', dir: '' }
      ]
    });
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(<QuickOpenDialog worktreeId="wt-1" onClose={onClose} onOpen={onOpen} />);

    fireEvent.change(screen.getByLabelText('Cari file'), { target: { value: 'app' } });

    await waitFor(() => expect(screen.getByText('app.tsx')).toBeTruthy());
    expect(mockedApiGet).toHaveBeenCalledWith('/files/find?worktreeId=wt-1&q=app');

    fireEvent.click(screen.getByText('app.tsx'));
    expect(onOpen).toHaveBeenCalledWith('src/app.tsx', 'app.tsx');
    expect(onClose).toHaveBeenCalled();
  });

  it('menampilkan pesan saat worktree belum dipilih', () => {
    render(<QuickOpenDialog worktreeId={null} onClose={() => undefined} onOpen={() => undefined} />);
    expect(screen.getByText('Pilih worktree terlebih dahulu.')).toBeTruthy();
  });
});
