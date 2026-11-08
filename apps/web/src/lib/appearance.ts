import type { TerminalThemeName } from './terminal-prefs';

export type SkinName = string;
export type LayoutName = 'orca-studio' | 'zen-focus';

export interface Appearance {
  skin: SkinName;
  layout: LayoutName;
}

export const SKINS: Array<{ id: SkinName; name: string }> = [
  { id: 'dorado-gold', name: 'Dorado Gold' },
  { id: 'orca-dark', name: 'Orca Dark' },
  { id: 'tokyo-night', name: 'Tokyo Night' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'matrix-term', name: 'Matrix Term' },
  { id: 'daylight-frost', name: 'Daylight Frost' }
];

export const LAYOUTS: Array<{ id: LayoutName; name: string; hint: string }> = [
  { id: 'orca-studio', name: 'Orca Studio', hint: 'Split klasik: sidebar + workspace' },
  { id: 'zen-focus', name: 'Zen Focus', hint: 'Kolom terpusat, drawer untuk panel' }
];

/** Peta skin → tema terminal xterm yang serasi. */
export const SKIN_TERMINAL_THEME: Record<string, TerminalThemeName> = {
  'dorado-gold': 'dark',
  'orca-dark': 'dark',
  'tokyo-night': 'dark',
  catppuccin: 'dark',
  'matrix-term': 'dark',
  'daylight-frost': 'light'
};

const STORAGE_KEY = 'dorado.appearance';
const SKIN_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const DEFAULT_APPEARANCE: Appearance = { skin: 'dorado-gold', layout: 'orca-studio' };

function isSkin(value: unknown): value is SkinName {
  return typeof value === 'string' && SKIN_RE.test(value);
}
function isLayout(value: unknown): value is LayoutName {
  return LAYOUTS.some((layout) => layout.id === value);
}

export function normalizeAppearance(input: unknown): Appearance {
  const raw = (input ?? {}) as Partial<Appearance>;
  return {
    skin: isSkin(raw.skin) ? raw.skin : DEFAULT_APPEARANCE.skin,
    layout: isLayout(raw.layout) ? raw.layout : DEFAULT_APPEARANCE.layout
  };
}

export function loadAppearanceLocal(): Appearance {
  try {
    return normalizeAppearance(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearanceLocal(appearance: Appearance): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // abaikan (mis. mode privasi)
  }
}

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.setAttribute('data-skin', appearance.skin);
  document.documentElement.setAttribute('data-layout', appearance.layout);
}

/** Muat (ulang) CSS plugin dari server sebagai <link> terpisah (0 KB bundle). */
export function refreshPluginStyles(): void {
  let link = document.getElementById('dorado-plugins') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = 'dorado-plugins';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `/api/plugins/styles.css?t=${Date.now()}`;
}
