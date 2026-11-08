import fs from 'node:fs';
import path from 'node:path';
import type { PluginInfo } from '@dorado/shared';
import { config } from '../../config.js';
import { AppError, notFound } from '../../lib/errors.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VAR_KEY_RE = /^--[a-z0-9-]+$/;

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  type?: string;
  cssVars?: Record<string, string>;
}

function pluginsDir(): string {
  return path.join(config.dataDir, 'plugins');
}
function manifestPath(id: string): string {
  return path.join(pluginsDir(), `${id}.json`);
}
function cssPath(id: string): string {
  return path.join(pluginsDir(), `${id}.css`);
}

/** Buang konstruksi CSS berbahaya (import eksternal, expression, url http). */
export function sanitizePluginCss(input: string): string {
  return input
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/javascript:/gi, '')
    .replace(/url\(\s*['"]?\s*(?:https?:)?\/\//gi, 'url(blocked:')
    .replace(/[{}]\s*[{}]/g, '')
    .replace(/<\/style/gi, '<\\/style');
}

function sanitizeVars(vars: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (!VAR_KEY_RE.test(key)) continue;
    out[key] = String(value)
      .replace(/[{}<>]/g, '')
      .slice(0, 200);
  }
  return out;
}

function readManifest(id: string): PluginManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(id), 'utf8')) as PluginManifest;
    return raw && typeof raw.id === 'string' ? raw : null;
  } catch {
    return null;
  }
}

function toInfo(manifest: PluginManifest): PluginInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version ?? null,
    type: manifest.type ?? 'theme',
    vars: Object.keys(sanitizeVars(manifest.cssVars)),
    hasCss: fs.existsSync(cssPath(manifest.id))
  };
}

export function listPlugins(): PluginInfo[] {
  let files: string[];
  try {
    files = fs.readdirSync(pluginsDir());
  } catch {
    return [];
  }
  const plugins: PluginInfo[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const manifest = readManifest(file.replace(/\.json$/, ''));
    if (manifest) plugins.push(toInfo(manifest));
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function installPlugin(manifest: PluginManifest, css = ''): PluginInfo {
  if (!ID_RE.test(manifest.id)) {
    throw new AppError(422, 'INVALID_PLUGIN_ID', 'Id plugin harus slug huruf kecil/angka/tanda hubung.');
  }
  if (String(manifest.id).endsWith('.css')) {
    throw new AppError(422, 'INVALID_PLUGIN_ID', 'Id plugin tidak valid.');
  }
  fs.mkdirSync(pluginsDir(), { recursive: true });
  const stored: PluginManifest = {
    id: manifest.id,
    name: String(manifest.name).slice(0, 60),
    version: manifest.version ? String(manifest.version).slice(0, 20) : undefined,
    type: manifest.type ? String(manifest.type).slice(0, 30) : 'theme',
    cssVars: sanitizeVars(manifest.cssVars)
  };
  fs.writeFileSync(manifestPath(stored.id), `${JSON.stringify(stored, null, 2)}\n`);
  fs.writeFileSync(cssPath(stored.id), sanitizePluginCss(css));
  return toInfo(stored);
}

export function removePlugin(id: string): boolean {
  if (!ID_RE.test(id)) return false;
  const exists = fs.existsSync(manifestPath(id));
  fs.rmSync(manifestPath(id), { force: true });
  fs.rmSync(cssPath(id), { force: true });
  return exists;
}

export function requirePlugin(id: string): PluginInfo {
  const manifest = readManifest(id);
  if (!manifest) throw notFound('Plugin tidak ditemukan.');
  return toInfo(manifest);
}

/** CSS gabungan semua plugin: skin vars + css kustom (tersanitasi). */
export function pluginStyles(): string {
  const blocks: string[] = [];
  for (const info of listPlugins()) {
    const manifest = readManifest(info.id);
    if (!manifest) continue;
    const vars = sanitizeVars(manifest.cssVars);
    const entries = Object.entries(vars).map(([key, value]) => `${key}: ${value};`);
    if (entries.length > 0) {
      blocks.push(`html[data-skin="${info.id}"] {\n  ${entries.join('\n  ')}\n}`);
    }
    try {
      const css = fs.readFileSync(cssPath(info.id), 'utf8');
      if (css.trim()) blocks.push(css);
    } catch {
      // tidak ada css kustom
    }
  }
  return blocks.join('\n\n');
}
