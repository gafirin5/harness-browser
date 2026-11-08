import { db } from '../../db/index.js';
import { stripAnsi } from '../../lib/ansi.js';
import { terminalManager } from '../terminals/manager.js';
import { markRateLimited } from './service.js';

const PATTERN = /(429|rate limit|rate_limit|quota exceeded|usage limit|too many requests|resets at)/i;
const lastHit = new Map<string, number>();
const COOLDOWN_MS = 60_000;

/**
 * Deteksi sinyal rate-limit pada output agent, lalu tandai profil aktif agent
 * tersebut sebagai cooldown. Mengembalikan fungsi untuk melepas listener.
 */
export function startRateLimitDetector(): () => void {
  return terminalManager.onOutput((terminalId, data) => {
    if (!PATTERN.test(stripAnsi(data))) return;
    const now = Date.now();
    if (now - (lastHit.get(terminalId) ?? 0) < COOLDOWN_MS) return;
    lastHit.set(terminalId, now);
    const session = db.prepare('SELECT agent FROM sessions WHERE terminal_id = ?').get(terminalId) as
      | { agent: string }
      | undefined;
    if (session) markRateLimited(session.agent);
  });
}
