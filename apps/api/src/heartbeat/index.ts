import { config } from '../config.js';
import { query, queryOne } from '../db/pool.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { recomputeAgentStatus } from '../modules/agents/service.js';
import { requestDispatch } from '../lib/queue-events.js';
import { scheduleSummaryBroadcast } from '../realtime/hub.js';

interface HeartbeatAgent {
  id: number;
  code: string;
  endpoint_url: string;
  auth_token_encrypted: string;
  status: string;
}

/** Mengembalikan true bila status agent berubah, agar dashboard di-broadcast. */
async function checkAgent(agent: HeartbeatAgent): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.healthTimeoutMs);
  try {
    const response = await fetch(`${agent.endpoint_url.replace(/\/$/, '')}/health`, {
      method: 'GET',
      headers: { authorization: `Bearer ${decryptSecret(agent.auth_token_encrypted)}` },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await query(
      `UPDATE agents SET last_heartbeat_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`,
      [agent.id]
    );
    const status = await recomputeAgentStatus(agent.id);
    return status !== agent.status;
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'Heartbeat timeout 5 detik' : (error as Error).message;
    await query(
      `UPDATE agents SET status = 'OFFLINE', last_error = $1, updated_at = now() WHERE id = $2`,
      [message.slice(0, 1000), agent.id]
    );
    return agent.status !== 'OFFLINE';
  } finally {
    clearTimeout(timer);
  }
}

export async function heartbeatOnce(): Promise<void> {
  const agents = await query<HeartbeatAgent>(
    `SELECT id, code, endpoint_url, auth_token_encrypted, status FROM agents WHERE is_active = true ORDER BY id`
  );
  if (agents.length === 0) return;

  let changed = false;
  const chunkSize = 10;
  for (let i = 0; i < agents.length; i += chunkSize) {
    const chunk = agents.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map((agent) => checkAgent(agent)));
    changed = changed || results.some(Boolean);
  }

  if (changed) {
    scheduleSummaryBroadcast();
    requestDispatch();
  }
}

let timer: NodeJS.Timeout | null = null;

export function startHeartbeat(): void {
  timer = setInterval(() => {
    heartbeatOnce().catch((error) => logger.error({ err: error }, 'Heartbeat error'));
  }, config.heartbeatIntervalMs);
  timer.unref();
  setTimeout(() => {
    heartbeatOnce().catch((error) => logger.error({ err: error }, 'Heartbeat error'));
  }, 1500).unref();
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function markStaleAgentsOffline(): Promise<number> {
  const staleMs = Math.max(config.heartbeatIntervalMs * 3, 90_000);
  const rows = await query<{ id: number }>(
    `UPDATE agents
     SET status = 'OFFLINE', last_error = 'Heartbeat kedaluwarsa', updated_at = now()
     WHERE is_active = true AND last_heartbeat_at IS NOT NULL
       AND last_heartbeat_at < now() - ($1::int * interval '1 millisecond')
       AND status <> 'OFFLINE'
     RETURNING id`,
    [staleMs]
  );
  return rows.length;
}
