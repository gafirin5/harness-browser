import type { Response } from 'express';
import { logger } from '../lib/logger.js';
import { getDashboardSummary } from '../modules/dashboard/service.js';

interface Client {
  id: number;
  userId: number;
  res: Response;
}

const clients = new Map<number, Client>();
let nextClientId = 1;
let pending: NodeJS.Timeout | null = null;
let lastSummaryAt = 0;

export function addClient(userId: number, res: Response): () => void {
  const id = nextClientId++;
  clients.set(id, { id, userId, res });
  return () => {
    clients.delete(id);
  };
}

export function clientCount(): number {
  return clients.size;
}

function writeChunk(client: Client, chunk: string): void {
  try {
    client.res.write(chunk);
  } catch {
    clients.delete(client.id);
  }
}

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients.values()) {
    writeChunk(client, payload);
  }
}

export async function broadcastSummaryNow(): Promise<void> {
  lastSummaryAt = Date.now();
  if (clients.size === 0) return;
  try {
    const summary = await getDashboardSummary();
    broadcast('summary', summary);
  } catch (error) {
    logger.error({ err: error }, 'Gagal broadcast summary');
  }
}

/** Debounce agar satu request yang mengubah beberapa tabel tidak memicu banyak query. */
export function scheduleSummaryBroadcast(): void {
  if (clients.size === 0) return;
  if (pending) return;
  const wait = Math.max(0, 150 - (Date.now() - lastSummaryAt));
  pending = setTimeout(() => {
    pending = null;
    void broadcastSummaryNow();
  }, wait);
  pending.unref();
}

export function broadcastTask(task: { id: number; code: string; status: string }): void {
  if (clients.size === 0) return;
  broadcast('task', task);
}

export function sendHeartbeat(): void {
  for (const client of clients.values()) {
    writeChunk(client, ': ping\n\n');
  }
}
