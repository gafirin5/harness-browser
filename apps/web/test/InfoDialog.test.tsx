import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoDialog } from '../src/components/InfoDialog';
import type { Info } from '../src/components/InfoDialog';
import { ToastProvider } from '../src/components/ui';
import { apiGet, copyText } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(),
    copyText: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);
const mockedCopyText = vi.mocked(copyText);

const info: Info = {
  version: '1.4.2',
  node: 'v20.11.1',
  uptimeSeconds: 7380,
  dataDir: '/home/dorado/.dorado',
  timezone: 'Asia/Jakarta',
  tmux: 'tmux 3.3a',
  agents: [
    { id: 'claude', name: 'Claude Code', command: 'claude', args: [], installed: true },
    { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: [], installed: false }
  ],
  counts: {
    projects: 2,
    worktrees: 3,
    terminals: 4,
    sessions: 5,
    providers: 6,
    agents: 7,
    tasks: 8
  }
};

function renderDialog(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <InfoDialog onClose={() => undefined} />
    </ToastProvider>
  );
}

describe('InfoDialog', () => {
  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedCopyText.mockReset();
  });

  it('menyalin ringkasan runtime sebagai teks', async () => {
    mockedApiGet.mockResolvedValue({ data: info });
    mockedCopyText.mockResolvedValue(true);

    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByText('1.4.2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salin Ringkasan' }));

    expect(mockedCopyText).toHaveBeenCalledTimes(1);
    const summary = mockedCopyText.mock.calls[0]![0];
    expect(summary).toContain('Versi: 1.4.2');
    expect(summary).toContain('Node.js: v20.11.1');
    expect(summary).toContain('Uptime: 2 jam 3 menit');
    expect(summary).toContain('Timezone: Asia/Jakarta');
    expect(summary).toContain('tmux: tmux 3.3a');
    expect(summary).toContain('Data dir: /home/dorado/.dorado');
    expect(summary).toContain('- Projects: 2');
    expect(summary).toContain('- Worktrees: 3');
    expect(summary).toContain('- Terminals: 4');
    expect(summary).toContain('- Sessions: 5');
    expect(summary).toContain('- Providers: 6');
    expect(summary).toContain('- Agents: 7');
    expect(summary).toContain('- Tasks: 8');
    expect(summary).toContain('Claude Code (claude): terpasang');
    expect(summary).toContain('Gemini CLI (gemini): tidak ada');
    expect(await screen.findByText('Ringkasan runtime disalin.')).toBeInTheDocument();
  });

  it('menampilkan toast gagal saat penyalinan gagal', async () => {
    mockedApiGet.mockResolvedValue({ data: info });
    mockedCopyText.mockResolvedValue(false);

    const user = userEvent.setup();
    renderDialog();

    await screen.findByText('1.4.2');
    await user.click(screen.getByRole('button', { name: 'Salin Ringkasan' }));

    expect(await screen.findByText('Gagal menyalin ringkasan runtime.')).toBeInTheDocument();
  });
});