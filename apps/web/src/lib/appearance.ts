import type { TerminalThemeName } from './terminal-prefs';

export type SkinName = 'dorado-gold' | 'orca-dark' | 'tokyo-night' | 'catppuccin' | 'matrix-term' | 'daylight-frost';
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
export const SKIN_TERMINAL_THEME: Record<SkinName, TerminalThemeName> = {
  'dorado-gold': 'dark',
  'orca-dark': 'dark',
  'tokyo-night': 'dark',
  catppuccin: 'dark',
  'matrix-term': 'dark',
  'daylight-frost': 'light'
};

const STORAGE_KEY = 'dorado.appearance';
export const DEFAULT_APPEARANCE: Appearance = { skin: 'dorado-gold', layout: 'orca-studio' };

function isSkin(value: unknown): value is SkinName {
  return SKINS.some((skin) => skin.id === value);
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
