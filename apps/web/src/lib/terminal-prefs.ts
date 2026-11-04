export type TerminalThemeName = 'dark' | 'light' | 'solarized';

export interface TerminalPrefs {
  fontSize: number;
  fontFamily: 'jetbrains' | 'mono' | 'fira';
  theme: TerminalThemeName;
  cursorBlink: boolean;
  searchKey: string;
  copyKey: string;
}

export const TERMINAL_THEMES: Record<TerminalThemeName, Record<string, string>> = {
  dark: {
    background: '#060a0f',
    foreground: '#dce8f5',
    cursor: '#f0b45c',
    cursorAccent: '#060a0f',
    selectionBackground: 'rgba(240, 180, 92, 0.25)',
    black: '#1a2430',
    red: '#ef7272',
    green: '#5fd18a',
    yellow: '#f0b45c',
    blue: '#6aa8ff',
    magenta: '#c792ea',
    cyan: '#59c7ba',
    white: '#dce8f5',
    brightBlack: '#5d7186',
    brightRed: '#ff9a9a',
    brightGreen: '#86e6aa',
    brightYellow: '#ffd08a',
    brightBlue: '#9cc4ff',
    brightMagenta: '#ddb4f2',
    brightCyan: '#8de3d8',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#fbfcfd',
    foreground: '#1d2833',
    cursor: '#b3661a',
    cursorAccent: '#fbfcfd',
    selectionBackground: 'rgba(53, 120, 210, 0.22)',
    black: '#1d2833',
    red: '#c0392b',
    green: '#20794b',
    yellow: '#9a6b00',
    blue: '#2f6fb5',
    magenta: '#8e44ad',
    cyan: '#1a7f74',
    white: '#5d7186',
    brightBlack: '#94a3b3',
    brightRed: '#e05a4c',
    brightGreen: '#2f9d64',
    brightYellow: '#b98a00',
    brightBlue: '#4a8bd6',
    brightMagenta: '#a55fc4',
    brightCyan: '#249b8e',
    brightWhite: '#1d2833'
  },
  solarized: {
    background: '#002b36',
    foreground: '#93a1a1',
    cursor: '#b58900',
    cursorAccent: '#002b36',
    selectionBackground: 'rgba(181, 137, 0, 0.25)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#93a1a1',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3'
  }
};

export const FONT_FAMILIES: Record<TerminalPrefs['fontFamily'], string> = {
  jetbrains: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
  mono: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
  fira: "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace"
};

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = {
  fontSize: 13,
  fontFamily: 'jetbrains',
  theme: 'dark',
  cursorBlink: true,
  searchKey: 'ctrl+f',
  copyKey: 'ctrl+shift+c'
};

const STORAGE_KEY = 'dorado-terminal-prefs';

export function loadTerminalPrefs(): TerminalPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TERMINAL_PREFS };
    const parsed = JSON.parse(raw) as Partial<TerminalPrefs>;
    return {
      ...DEFAULT_TERMINAL_PREFS,
      ...parsed,
      fontSize:
        typeof parsed.fontSize === 'number' && parsed.fontSize >= 9 && parsed.fontSize <= 24
          ? parsed.fontSize
          : DEFAULT_TERMINAL_PREFS.fontSize
    };
  } catch {
    return { ...DEFAULT_TERMINAL_PREFS };
  }
}

export function saveTerminalPrefs(prefs: TerminalPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // abaikan bila localStorage diblokir
  }
}

export function comboFromEvent(event: KeyboardEvent): string | null {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  if (['control', 'shift', 'alt', 'meta'].includes(key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

export function formatCombo(combo: string): string {
  return combo
    .split('+')
    .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('+');
}

export function matchesCombo(event: KeyboardEvent, combo: string): boolean {
  const pressed = comboFromEvent(event);
  return pressed !== null && pressed === combo;
}
