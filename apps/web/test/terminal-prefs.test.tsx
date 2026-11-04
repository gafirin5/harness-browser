import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalSettingsDialog } from '../src/components/TerminalSettingsDialog';
import {
  DEFAULT_TERMINAL_PREFS,
  comboFromEvent,
  formatCombo,
  loadTerminalPrefs,
  matchesCombo,
  saveTerminalPrefs
} from '../src/lib/terminal-prefs';

describe('terminal prefs', () => {
  it('membentuk dan mencocokkan kombinasi tombol', () => {
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true });
    expect(comboFromEvent(event)).toBe('ctrl+shift+c');
    expect(matchesCombo(event, 'ctrl+shift+c')).toBe(true);
    expect(matchesCombo(event, 'ctrl+f')).toBe(false);
    expect(formatCombo('ctrl+shift+c')).toBe('Ctrl+Shift+C');
  });

  it('menyimpan dan memuat preferensi dari localStorage', () => {
    saveTerminalPrefs({ ...DEFAULT_TERMINAL_PREFS, fontSize: 16, theme: 'light' });
    const loaded = loadTerminalPrefs();
    expect(loaded.fontSize).toBe(16);
    expect(loaded.theme).toBe('light');
    expect(loaded.searchKey).toBe('ctrl+f');
  });
});

describe('TerminalSettingsDialog', () => {
  it('menyimpan tema dan keymap baru', () => {
    const onSave = vi.fn();
    render(<TerminalSettingsDialog prefs={DEFAULT_TERMINAL_PREFS} onSave={onSave} onClose={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Tema terminal'), { target: { value: 'solarized' } });

    const copyInput = screen.getByLabelText('Shortcut salin terminal');
    fireEvent.keyDown(copyInput, { key: 'x', ctrlKey: true, shiftKey: true });

    fireEvent.click(screen.getByText('Simpan'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ theme: 'solarized', copyKey: 'ctrl+shift+x' }));
  });
});
