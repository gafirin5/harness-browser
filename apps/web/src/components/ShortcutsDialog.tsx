import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  ACTION_LABELS,
  DEFAULT_KEYMAP,
  RESERVED_COMBOS,
  comboFromEvent,
  findKeymapConflicts,
  formatCombo,
  type GlobalAction,
  type Keymap
} from '../lib/keymap';
import { Modal } from './ui';

const FIXED_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+K / Ctrl+Shift+P', label: 'Command palette' },
  { keys: 'Ctrl+Shift+F', label: 'Cari kode di worktree' },
  { keys: 'Ctrl+S', label: 'Simpan file di editor' },
  { keys: 'Ctrl+Enter', label: 'Submit form/dialog aktif' },
  { keys: 'Escape', label: 'Tutup dialog/palette' }
];

export function ShortcutsDialog({
  keymap,
  onSave,
  onClose
}: {
  keymap: Keymap;
  onSave: (keymap: Keymap) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Keymap>({ ...keymap });
  const actions = Object.keys(ACTION_LABELS) as GlobalAction[];

  const conflicts = useMemo(() => findKeymapConflicts(draft), [draft]);
  const reservedConflicts = useMemo(
    () =>
      actions
        .filter((action) => RESERVED_COMBOS.some((reserved) => reserved.combo === draft[action]))
        .map((action) => ({
          action,
          reserved: RESERVED_COMBOS.find((reserved) => reserved.combo === draft[action])
        })),
    [draft, actions]
  );

  const capture = (action: GlobalAction) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    const combo = comboFromEvent(event.nativeEvent);
    if (combo) setDraft((current) => ({ ...current, [action]: combo }));
  };

  return (
    <Modal
      title="Keyboard Shortcuts"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => setDraft({ ...DEFAULT_KEYMAP })}>
            Default
          </button>
          <button className="btn" onClick={onClose}>
            Batal
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            disabled={conflicts.length > 0 || reservedConflicts.length > 0}
          >
            Simpan Keymap
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Klik field shortcut lalu tekan kombinasi baru. Shortcut global tidak aktif saat fokus di input, textarea,
        select, atau terminal. Ctrl+Enter tetap berlaku di dalam form.
      </p>
      {conflicts.length > 0 ? (
        <div className="error-banner">
          Konflik: {conflicts.map((item) => formatCombo(item.combo)).join(', ')} dipakai lebih dari satu aksi.
        </div>
      ) : null}
      {reservedConflicts.length > 0 ? (
        <div className="error-banner">
          Bentrok dengan shortcut tetap:{' '}
          {reservedConflicts
            .map((item) => `${formatCombo(draft[item.action])} (${item.reserved?.label ?? 'reserved'})`)
            .join(', ')}
          .
        </div>
      ) : null}

      <div className="shortcut-list">
        {actions.map((action) => {
          const conflict = conflicts.find((item) => item.actions.includes(action));
          return (
            <div className="shortcut-row" key={action}>
              <input
                className={`input keymap-input ${conflict ? 'conflict' : ''}`}
                readOnly
                value={formatCombo(draft[action])}
                onKeyDown={capture(action)}
                aria-label={`Shortcut ${ACTION_LABELS[action]}`}
              />
              <span>{ACTION_LABELS[action]}</span>
            </div>
          );
        })}
      </div>

      <div className="section-label">Shortcut tetap</div>
      <div className="shortcut-list">
        {FIXED_SHORTCUTS.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.keys}>
            <kbd className="kbd">{shortcut.keys}</kbd>
            <span>{shortcut.label}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
