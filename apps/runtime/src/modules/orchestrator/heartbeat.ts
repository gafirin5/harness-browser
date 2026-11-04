import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { decryptSecret } from './crypto.js';
import { markAgentHealthy, markStaleAgentsOffline, recomputeAgentStatus, setAgentOffline } from './service.js';
import { requestDispatch } from './events.js';
import { scheduleSummaryBroadcast } from './hub.js';

interface HeartbeatAgent {
  id: number;
  code: string;
  endpoint_url: string;
  auth_token_encrypted: string;
  status: string;
}

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
    markAgentHealthy(agent.id);
    const status = recomputeAgentStatus(agent.id);
    return status !== agent.status;
  } catch (error) {
    const message =
      (error as Error).name === 'AbortError'
        ? `Heartbeat timeout ${Math.round(config.healthTimeoutMs / 1000)} detik`
        : (error as Error).message;
    setAgentOffline(agent.id, message);
    return agent.status !== 'OFFLINE';
  } finally {
    clearTimeout(timer);
  }
}

export async function heartbeatOnce(): Promise<void> {
  const agents = db
    .prepare('SELECT id, code, endpoint_url, auth_token_encrypted, status FROM agents WHERE is_active = 1 ORDER BY id')
    .all() as unknown as HeartbeatAgent[];
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
  if (timer) return;
  timer = setInterval(() => {
    heartbeatOnce().catch((error) => console.error('[dorado] heartbeat error', error));
  }, config.heartbeatIntervalMs);
  timer.unref();
  setTimeout(() => {
    heartbeatOnce().catch((error) => console.error('[dorado] heartbeat error', error));
  }, 1500).unref();
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { markStaleAgentsOffline };