import { Modal } from './ui';

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+K / Ctrl+Shift+P', label: 'Command palette' },
  { keys: 'Ctrl+Shift+F', label: 'Cari kode di worktree' },
  { keys: 'Ctrl+F', label: 'Cari di terminal (saat terminal fokus)' },
  { keys: 'Ctrl+S', label: 'Simpan file di editor' },
  { keys: 'Ctrl+Enter', label: 'Submit form/dialog aktif' },
  { keys: 'Escape', label: 'Tutup dialog/palette' },
  { keys: 'Alt+P', label: 'Quick Open file' },
  { keys: 'Alt+J', label: 'Jump ke worktree/tab' },
  { keys: 'Alt+T', label: 'Terminal baru' },
  { keys: 'Alt+A', label: 'Jalankan agent' },
  { keys: 'Alt+O', label: 'Buka Orchestrator' },
  { keys: 'Alt+G', label: 'Buka GitHub' },
  { keys: 'Alt+Shift+G', label: 'Buka Git Graph' },
  { keys: 'Alt+H', label: 'Riwayat sesi' },
  { keys: 'Alt+S', label: 'Setelan' },
  { keys: 'Alt+/', label: 'Daftar shortcut ini' },
  { keys: 'Alt+] / Alt+[', label: 'Tab berikutnya/sebelumnya' },
  { keys: 'Alt+W', label: 'Tutup tab aktif' }
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal
      title="Keyboard Shortcuts"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Shortcut global tidak aktif saat fokus berada di input, textarea, select, atau terminal. Ctrl+Enter tetap
        berlaku di dalam form.
      </p>
      <div className="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.keys}>
            <kbd className="kbd">{shortcut.keys}</kbd>
            <span>{shortcut.label}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
