import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYMAP, actionForEvent, findKeymapConflicts, loadKeymap, saveKeymap } from '../src/lib/keymap';

describe('global keymap', () => {
  it('menyimpan dan memuat keymap dari localStorage', () => {
    saveKeymap({ ...DEFAULT_KEYMAP, jump: 'ctrl+shift+j' });
    expect(loadKeymap().jump).toBe('ctrl+shift+j');
  });

  it('mendeteksi konflik antar aksi', () => {
    expect(findKeymapConflicts(DEFAULT_KEYMAP)).toHaveLength(0);
    const conflicts = findKeymapConflicts({ ...DEFAULT_KEYMAP, jump: DEFAULT_KEYMAP.quickOpen });
    expect(conflicts[0]?.actions).toEqual(expect.arrayContaining(['jump', 'quickOpen']));
  });

  it('memetakan event ke aksi', () => {
    const event = new KeyboardEvent('keydown', { key: 'j', altKey: true });
    expect(actionForEvent(DEFAULT_KEYMAP, event)).toBe('jump');
    const plain = new KeyboardEvent('keydown', { key: 'j' });
    expect(actionForEvent(DEFAULT_KEYMAP, plain)).toBeNull();
  });
});
