import fs from 'node:fs';
import path from 'node:path';
import type { UpdateHistoryEntry } from '@dorado/shared';
import { config } from '../../config.js';

function historyFile(): string {
  return path.join(config.dataDir, 'update-history.jsonl');
}

/** Catat satu pembaruan (append-only JSONL di DATA_DIR). */
export function appendUpdateHistory(entry: UpdateHistoryEntry): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(historyFile(), `${JSON.stringify(entry)}\n`);
  } catch {
    // abaikan kegagalan menulis riwayat
  }
}

export function readUpdateHistory(limit = 20): UpdateHistoryEntry[] {
  try {
    const lines = fs.readFileSync(historyFile(), 'utf8').split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => JSON.parse(line) as UpdateHistoryEntry)
      .reverse();
  } catch {
    return [];
  }
}
