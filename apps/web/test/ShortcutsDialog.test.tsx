import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsDialog } from '../src/components/ShortcutsDialog';

describe('ShortcutsDialog', () => {
  it('menampilkan shortcut utama dan menutup lewat tombol', () => {
    const onClose = vi.fn();
    render(<ShortcutsDialog onClose={onClose} />);

    expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
    expect(screen.getByText('Ctrl+Enter')).toBeTruthy();
    expect(screen.getByText('Alt+P')).toBeTruthy();
    expect(screen.getByText('Alt+J')).toBeTruthy();
    expect(screen.getByText('Alt+W')).toBeTruthy();

    fireEvent.click(screen.getByText('Tutup'));
    expect(onClose).toHaveBeenCalled();
  });
});
