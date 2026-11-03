import { config } from '../config.js';
import { queryOne, withTransaction } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { getAgentDispatchConfig, recomputeAgentStatus } from '../modules/agents/service.js';
import { getProviderCredentials } from '../modules/providers/service.js';
import { broadcastTask, scheduleSummaryBroadcast } from '../realtime/hub.js';
import { onDispatchRequest } from '../lib/queue-events.js';

interface QueueTask {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: number;
  agentId: number;
  providerId: number;
  createdAt: Date;
}

let pumping = false;

async function claimNextTask(): Promise<QueueTask | null> {
  return withTransaction(async (client) => {
    const candidate = await client.query<{
      id: number;
      code: string;
      title: string;
      prompt: string;
      priority: number;
      agent_id: number;
      provider_id: number;
      created_at: Date;
    }>(
      `SELECT t.id, t.code, t.title, t.prompt, t.priority, t.agent_id, t.provider_id, t.created_at
       FROM tasks t
       JOIN agents a ON a.id = t.agent_id
       WHERE t.status = 'QUEUED'
         AND a.is_active = true
         AND a.status <> 'OFFLINE'
         AND a.active_tasks_count < a.max_concurrency
       ORDER BY t.priority DESC, t.created_at ASC, t.id ASC
       LIMIT 1
       FOR UPDATE OF t SKIP LOCKED`
    );
    const row = candidate.rows[0];
    if (!row) return null;

    const agent = await client.query<{ active_tasks_count: number; max_concurrency: number; status: string; is_active: boolean }>(
      'SELECT active_tasks_count, max_concurrency, status, is_active FROM agents WHERE id = $1 FOR UPDATE',
      [row.agent_id]
    );
    const a = agent.rows[0];
    if (!a || !a.is_active || a.status === 'OFFLINE' || a.active_tasks_count >= a.max_concurrency) {
      return null;
    }

    const updated = await client.query<{ id: number }>(
      `UPDATE tasks SET status = 'RUNNING', started_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'QUEUED'
       RETURNING id`,
      [row.id]
    );
    if (!updated.rows[0]) return null;
    await client.query(
      `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message)
       VALUES ($1, NULL, 'SYSTEM', 'QUEUED', 'RUNNING', 'INFO', 'Task dikirim ke agent.')`,
      [row.id]
    );
    await recomputeAgentStatus(row.agent_id, client);

    return {
      id: row.id,
      code: row.code,
      title: row.title,
      prompt: row.prompt,
      priority: row.priority,
      agentId: row.agent_id,
      providerId: row.provider_id,
      createdAt: row.created_at
    };
  });
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.dispatchTimeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function markAgentOffline(agentId: number, message: string): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE agents SET status = 'OFFLINE', last_error = $1, updated_at = now() WHERE id = $2`,
      [message, agentId]
    );
  });
}

async function markDispatchFailed(task: QueueTask, reason: string): Promise<void> {
  await withTransaction(async (client) => {
    const selected = await client.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1 FOR UPDATE', [task.id]);
    if (selected.rows[0]?.status !== 'RUNNING') return;

    await client.query(
      `UPDATE tasks
       SET status = 'FAILED', error_message = $1, finished_at = now(), updated_at = now()
       WHERE id = $2`,
      [reason.slice(0, 2000), task.id]
    );
    await client.query(
      `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message)
       VALUES ($1, NULL, 'SYSTEM', 'RUNNING', 'FAILED', 'ERROR', $2)`,
      [task.id, `Gagal menghubungi endpoint agent. Task ditandai FAILED. (${reason})`]
    );
    await recomputeAgentStatus(task.agentId, client);
  });

  scheduleSummaryBroadcast();
  broadcastTask({ id: task.id, code: task.code, status: 'FAILED' });
}

async function dispatchTask(task: QueueTask): Promise<void> {
  let agent: Awaited<ReturnType<typeof getAgentDispatchConfig>> = null;
  let provider: Awaited<ReturnType<typeof getProviderCredentials>> = null;
  try {
    [agent, provider] = await Promise.all([
      getAgentDispatchConfig(task.agentId),
      getProviderCredentials(task.providerId)
    ]);
  } catch (error) {
    // Mis. API key provider gagal didekripsi. Jangan biarkan task RUNNING menggantung.
    await markDispatchFailed(task, `Konfigurasi provider gagal dibaca: ${(error as Error).message}`);
    scheduleSummaryBroadcast();
    return;
  }
  if (!agent || !provider) {
    await markDispatchFailed(task, 'Konfigurasi agent atau provider tidak ditemukan.');
    return;
  }

  const payload = {
    schema: 'orca.task.v1',
    task: {
      code: task.code,
      title: task.title,
      prompt: task.prompt,
      priority: task.priority,
      created_at: task.createdAt.toISOString()
    },
    provider: {
      type: provider.providerType,
      base_url: provider.baseUrl,
      model: provider.defaultModel,
      ...(config.agentKeyDelivery === 'payload' ? { api_key: provider.apiKey } : {})
    },
    callback: { url: `${config.publicBaseUrl}/api/agent/tasks/${encodeURIComponent(task.code)}/result` },
    deadline_at: new Date(Date.now() + config.taskMaxDurationMs).toISOString()
  };

  const timeout = withTimeout();
  try {
    const response = await fetch(`${agent.endpointUrl.replace(/\/$/, '')}/tasks`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${agent.token}`,
        'idempotency-key': task.code
      },
      body: JSON.stringify(payload),
      signal: timeout.signal
    });
    if (!response.ok) {
      throw new Error(`Agent merespons HTTP ${response.status}`);
    }
  } catch (error) {
    const name = (error as Error).name;
    const message = name === 'AbortError' ? 'Timeout 5 detik' : (error as Error).message;
    // Hanya kegagalan konektivitas yang menandai agent OFFLINE.
    // Respons HTTP non-2xx berarti agent hidup tetapi menolak task.
    const connectivityFailure = name === 'AbortError' || error instanceof TypeError;
    if (connectivityFailure) {
      await markAgentOffline(task.agentId, `Dispatch gagal: ${message}`);
    }
    await markDispatchFailed(task, message);
    scheduleSummaryBroadcast();
  } finally {
    timeout.clear();
  }
}

export async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (let i = 0; i < 20; i += 1) {
      const task = await claimNextTask();
      if (!task) break;
      scheduleSummaryBroadcast();
      broadcastTask({ id: task.id, code: task.code, status: 'RUNNING' });
      await dispatchTask(task);
    }
  } catch (error) {
    logger.error({ err: error }, 'Dispatcher error');
  } finally {
    pumping = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startDispatcher(): void {
  onDispatchRequest(() => {
    void pump();
  });
  timer = setInterval(() => {
    void pump();
  }, 2000);
  timer.unref();
  void pump();
}

export function stopDispatcher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
