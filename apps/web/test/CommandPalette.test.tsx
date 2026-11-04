import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../src/components/CommandPalette';

describe('CommandPalette', () => {
  it('memfilter perintah dan menjalankannya dengan Enter', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const runTerminal = vi.fn();
    const runOrchestrator = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[
          { id: 'terminal', label: 'Terminal Baru', hint: 'shell', run: runTerminal },
          { id: 'orchestrator', label: 'Orchestrator', hint: 'task', run: runOrchestrator }
        ]}
      />
    );

    const input = screen.getByLabelText('Cari perintah');
    await user.type(input, 'orch');
    expect(screen.getByText('Orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('Terminal Baru')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(runOrchestrator).toHaveBeenCalledTimes(1);
    expect(runTerminal).not.toHaveBeenCalled();
  });

  it('menutup palette dengan Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={[]} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
