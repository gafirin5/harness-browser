import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsDialog } from '../src/components/ShortcutsDialog';
import { DEFAULT_KEYMAP, formatCombo } from '../src/lib/keymap';

describe('ShortcutsDialog', () => {
  it('menampilkan shortcut utama dan menutup lewat tombol', () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog keymap={DEFAULT_KEYMAP} onSave={() => undefined} onClose={onClose} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
    expect(screen.getByText('Ctrl+Enter')).toBeTruthy();
    expect((screen.getByLabelText('Shortcut Quick Open file') as HTMLInputElement).value).toBe('Alt+P');
    expect(screen.getAllByText('Quick Open file').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('Batal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('merekam kombinasi baru dan menolak konflik', () => {
    const onSave = vi.fn();
    render(<ShortcutsDialog keymap={DEFAULT_KEYMAP} onSave={onSave} onClose={() => undefined} />);

    const input = screen.getByLabelText('Shortcut Quick Open file');
    fireEvent.keyDown(input, { key: 'u', ctrlKey: true, shiftKey: true });
    expect((input as HTMLInputElement).value).toBe('Ctrl+Shift+U');

    fireEvent.click(screen.getByText('Simpan Keymap'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ quickOpen: 'ctrl+shift+u' }));

    fireEvent.keyDown(input, { key: 't', altKey: true });
    expect(screen.getByText(/Konflik:/)).toBeTruthy();
    expect((screen.getByText('Simpan Keymap') as HTMLButtonElement).disabled).toBe(true);
  });

  it('memformat kombinasi dengan benar', () => {
    expect(formatCombo('alt+shift+g')).toBe('Alt+Shift+G');
  });
});
