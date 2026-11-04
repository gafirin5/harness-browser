import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  DEFAULT_TERMINAL_PREFS,
  TERMINAL_THEMES,
  comboFromEvent,
  formatCombo,
  type TerminalPrefs,
  type TerminalThemeName
} from '../lib/terminal-prefs';
import { Modal } from './ui';

export function TerminalSettingsDialog({
  prefs,
  onSave,
  onClose
}: {
  prefs: TerminalPrefs;
  onSave: (prefs: TerminalPrefs) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<TerminalPrefs>({ ...prefs });

  const set = <K extends keyof TerminalPrefs>(key: K, value: TerminalPrefs[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const capture = (key: 'searchKey' | 'copyKey') => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    const combo = comboFromEvent(event.nativeEvent);
    if (combo) set(key, combo);
  };

  return (
    <Modal
      title="Terminal & Keymap"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => setDraft({ ...DEFAULT_TERMINAL_PREFS })}>
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
          >
            Simpan
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Tema terminal</label>
          <select
            className="input"
            value={draft.theme}
            onChange={(event) => set('theme', event.target.value as TerminalThemeName)}
            aria-label="Tema terminal"
          >
            {(Object.keys(TERMINAL_THEMES) as TerminalThemeName[]).map((name) => (
              <option key={name} value={name}>
                {name === 'dark' ? 'Dark' : name === 'light' ? 'Light' : 'Solarized'}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Ukuran font</label>
          <select
            className="input"
            value={draft.fontSize}
            onChange={(event) => set('fontSize', Number(event.target.value))}
            aria-label="Ukuran font terminal"
          >
            {[11, 12, 13, 14, 15, 16, 18].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Font</label>
        <select
          className="input"
          value={draft.fontFamily}
          onChange={(event) => set('fontFamily', event.target.value as TerminalPrefs['fontFamily'])}
          aria-label="Font terminal"
        >
          <option value="jetbrains">JetBrains Mono</option>
          <option value="mono">System monospace</option>
          <option value="fira">Fira Code</option>
        </select>
      </div>
      <label className="automation-enabled" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={draft.cursorBlink}
          onChange={(event) => set('cursorBlink', event.target.checked)}
        />
        Kursor berkedip
      </label>

      <div className="section-label">Keymap terminal</div>
      <div className="field">
        <label>Cari di terminal</label>
        <input
          className="input keymap-input"
          readOnly
          value={formatCombo(draft.searchKey)}
          onKeyDown={capture('searchKey')}
          aria-label="Shortcut cari terminal"
        />
      </div>
      <div className="field">
        <label>Salin seleksi</label>
        <input
          className="input keymap-input"
          readOnly
          value={formatCombo(draft.copyKey)}
          onKeyDown={capture('copyKey')}
          aria-label="Shortcut salin terminal"
        />
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>
        Klik field shortcut lalu tekan kombinasi baru. Preferensi disimpan di browser ini dan langsung diterapkan ke
        terminal. Tema memakai palet {Object.keys(TERMINAL_THEMES).length} pilihan tanpa CSS baru.
      </p>
    </Modal>
  );
}
