import { db } from '../../db/index.js';
import { apiKeyLast4, decryptSecret, encryptSecret } from '../../lib/secret.js';

const LINEAR_KEY = 'linear_api_key';

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function getEncrypted(key: string): string | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    return null;
  }
}

export function getLinearKey(): string | null {
  return getEncrypted(LINEAR_KEY);
}

export function setLinearKey(apiKey: string): void {
  setSetting(LINEAR_KEY, encryptSecret(apiKey));
}

export function clearLinearKey(): void {
  deleteSetting(LINEAR_KEY);
}

export function linearKeyLast4(): string | null {
  const key = getLinearKey();
  return key ? apiKeyLast4(key) : null;
}
