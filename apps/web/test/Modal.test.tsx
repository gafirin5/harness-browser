import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../src/components/ui';

function body() {
  return (
    <Modal title="Test Modal" onClose={() => undefined}>
      <input aria-label="Judul" />
    </Modal>
  );
}

describe('Modal', () => {
  it('memfokuskan field body, bukan tombol tutup', async () => {
    render(body());
    const input = screen.getByLabelText('Judul');
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Tutup' })).not.toHaveFocus();
  });

  it('tidak merebut fokus ketika onClose berubah', async () => {
    const { rerender } = render(body());
    const input = screen.getByLabelText('Judul');
    await waitFor(() => expect(input).toHaveFocus());

    rerender(
      <Modal title="Test Modal" onClose={() => undefined}>
        <input aria-label="Judul" />
      </Modal>
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(input).toHaveFocus();
  });

  it('menutup dengan Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal title="Test Modal" onClose={onClose}>
        <input aria-label="Judul" />
      </Modal>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
