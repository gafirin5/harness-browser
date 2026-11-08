import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppearanceDialog } from '../src/components/AppearanceDialog';
import { ToastProvider } from '../src/components/ui';
import { DEFAULT_APPEARANCE } from '../src/lib/appearance';

describe('AppearanceDialog', () => {
  it('memanggil onChange saat memilih tema', () => {
    const onChange = vi.fn();
    render(
      <ToastProvider>
        <AppearanceDialog appearance={DEFAULT_APPEARANCE} onChange={onChange} onClose={() => undefined} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Tokyo Night'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ skin: 'tokyo-night' }));
  });

  it('menampilkan seluruh 6 tema', () => {
    render(
      <ToastProvider>
        <AppearanceDialog appearance={DEFAULT_APPEARANCE} onChange={() => undefined} onClose={() => undefined} />
      </ToastProvider>
    );
    for (const name of ['Dorado Gold', 'Orca Dark', 'Tokyo Night', 'Catppuccin', 'Matrix Term', 'Daylight Frost']) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('memanggil onChange saat memilih layout', () => {
    const onChange = vi.fn();
    render(
      <ToastProvider>
        <AppearanceDialog appearance={DEFAULT_APPEARANCE} onChange={onChange} onClose={() => undefined} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('Zen Focus'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layout: 'zen-focus' }));
  });
});
