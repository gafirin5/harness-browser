import { comboFromEvent, formatCombo } from './terminal-prefs';

export type GlobalAction =
  | 'terminal'
  | 'agent'
  | 'orchestrator'
  | 'github'
  | 'gitGraph'
  | 'history'
  | 'settings'
  | 'quickOpen'
  | 'jump'
  | 'shortcuts'
  | 'nextTab'
  | 'prevTab'
  | 'closeTab';

export type Keymap = Record<GlobalAction, string>;

export const ACTION_LABELS: Record<GlobalAction, string> = {
  terminal: 'Terminal baru',
  agent: 'Jalankan agent',
  orchestrator: 'Buka Orchestrator',
  github: 'Buka GitHub',
  gitGraph: 'Buka Git Graph',
  history: 'Riwayat sesi',
  settings: 'Setelan keamanan',
  quickOpen: 'Quick Open file',
  jump: 'Jump ke worktree/tab',
  shortcuts: 'Daftar shortcut',
  nextTab: 'Tab berikutnya',
  prevTab: 'Tab sebelumnya',
  closeTab: 'Tutup tab aktif'
};

export const DEFAULT_KEYMAP: Keymap = {
  terminal: 'alt+t',
  agent: 'alt+a',
  orchestrator: 'alt+o',
  github: 'alt+g',
  gitGraph: 'alt+shift+g',
  history: 'alt+h',
  settings: 'alt+s',
  quickOpen: 'alt+p',
  jump: 'alt+j',
  shortcuts: 'alt+/',
  nextTab: 'alt+]',
  prevTab: 'alt+[',
  closeTab: 'alt+w'
};

export const RESERVED_COMBOS: Array<{ combo: string; label: string }> = [
  { combo: 'ctrl+shift+p', label: 'Command palette' },
  { combo: 'ctrl+k', label: 'Command palette' },
  { combo: 'ctrl+shift+f', label: 'Cari kode' },
  { combo: 'ctrl+f', label: 'Cari terminal' },
  { combo: 'ctrl+enter', label: 'Submit form' }
];

const STORAGE_KEY = 'dorado-keymap';

export function loadKeymap(): Keymap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const parsed = JSON.parse(raw) as Partial<Keymap>;
    return { ...DEFAULT_KEYMAP, ...parsed };
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(keymap: Keymap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keymap));
  } catch {
    // abaikan bila localStorage diblokir
  }
}

export function findKeymapConflicts(keymap: Keymap): Array<{ combo: string; actions: GlobalAction[] }> {
  const byCombo = new Map<string, GlobalAction[]>();
  for (const action of Object.keys(keymap) as GlobalAction[]) {
    const combo = keymap[action];
    const list = byCombo.get(combo) ?? [];
    list.push(action);
    byCombo.set(combo, list);
  }
  return Array.from(byCombo.entries())
    .filter(([, actions]) => actions.length > 1)
    .map(([combo, actions]) => ({ combo, actions }));
}

export function conflictingAction(keymap: Keymap, action: GlobalAction): GlobalAction | null {
  const combo = keymap[action];
  for (const other of Object.keys(keymap) as GlobalAction[]) {
    if (other !== action && keymap[other] === combo) return other;
  }
  return null;
}

export function actionForEvent(keymap: Keymap, event: KeyboardEvent): GlobalAction | null {
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null;
  const combo = comboFromEvent(event);
  if (!combo) return null;
  for (const action of Object.keys(keymap) as GlobalAction[]) {
    if (keymap[action] === combo) return action;
  }
  return null;
}

export { comboFromEvent, formatCombo };
export type { Keymap as GlobalKeymap };
