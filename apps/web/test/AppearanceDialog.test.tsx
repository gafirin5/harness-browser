import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppearanceDialog } from '../src/components/AppearanceDialog';
import { ToastProvider } from '../src/components/ui';
import { DEFAULT_APPEARANCE } from '../src/lib/appearance';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn(() => Promise.resolve({ data: [] })),
    apiPost: vi.fn(),
    apiDelete: vi.fn()
  };
});

function renderDialog(onChange: (next: unknown) => void): void {
  render(
    <ToastProvider>
      <AppearanceDialog
        appearance={DEFAULT_APPEARANCE}
        isAdmin
        onChange={onChange}
        onPluginsChanged={() => undefined}
        onClose={() => undefined}
      />
    </ToastProvider>
  );
}

describe('AppearanceDialog', () => {
  it('memanggil onChange saat memilih tema', () => {
    const onChange = vi.fn();
    renderDialog(onChange);
    fireEvent.click(screen.getByText('Tokyo Night'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ skin: 'tokyo-night' }));
  });

  it('menampilkan seluruh 6 tema', () => {
    renderDialog(() => undefined);
    for (const name of ['Dorado Gold', 'Orca Dark', 'Tokyo Night', 'Catppuccin', 'Matrix Term', 'Daylight Frost']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('memanggil onChange saat memilih layout', () => {
    const onChange = vi.fn();
    renderDialog(onChange);
    fireEvent.click(screen.getByText('Zen Focus'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layout: 'zen-focus' }));
  });
});
