import { config } from '../../config.js';
import { getProviderCredentials } from './service.js';
import type { QueueTask } from './service.js';
import { claimNextTask, getAgentDispatchConfig, markDispatchFailed, setAgentOffline } from './service.js';
import { onDispatchRequest } from './events.js';
import { broadcastTask, scheduleSummaryBroadcast } from './hub.js';

let pumping = false;

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.dispatchTimeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function dispatchTask(task: QueueTask): Promise<void> {
  let agent: ReturnType<typeof getAgentDispatchConfig> = null;
  let provider: ReturnType<typeof getProviderCredentials> = null;
  try {
    agent = getAgentDispatchConfig(task.agentId);
    provider = getProviderCredentials(task.providerId);
  } catch (error) {
    markDispatchFailed(task, `Konfigurasi provider gagal dibaca: ${(error as Error).message}`);
    scheduleSummaryBroadcast();
    return;
  }
  if (!agent || !provider) {
    markDispatchFailed(task, 'Konfigurasi agent atau provider tidak ditemukan.');
    return;
  }

  const payload = {
    schema: 'orca.task.v1',
    task: {
      code: task.code,
      title: task.title,
      prompt: task.prompt,
      priority: task.priority,
      created_at: new Date(task.createdAt).toISOString()
    },
    provider: {
      type: provider.providerType,
      base_url: provider.baseUrl,
      model: provider.defaultModel,
      ...(config.agentKeyDelivery === 'payload' ? { api_key: provider.apiKey } : {})
    },
    callback: {
      url: `${config.publicBaseUrl}/api/orchestrator/agent/tasks/${encodeURIComponent(task.code)}/result`
    },
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
    if (!response.ok) throw new Error(`Agent merespons HTTP ${response.status}`);
  } catch (error) {
    const name = (error as Error).name;
    const message =
      name === 'AbortError' ? `Timeout ${Math.round(config.dispatchTimeoutMs / 1000)} detik` : (error as Error).message;
    const connectivityFailure = name === 'AbortError' || error instanceof TypeError;
    if (connectivityFailure) setAgentOffline(task.agentId, `Dispatch gagal: ${message}`);
    markDispatchFailed(task, message);
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
      const task = claimNextTask();
      if (!task) break;
      scheduleSummaryBroadcast();
      broadcastTask({ id: task.id, code: task.code, status: 'RUNNING' });
      await dispatchTask(task);
    }
  } catch (error) {
    console.error('[dorado] dispatcher error', error);
  } finally {
    pumping = false;
  }
}

let timer: NodeJS.Timeout | null = null;
let unsubscribed = false;

export function startDispatcher(): void {
  if (timer) return;
  if (!unsubscribed) {
    onDispatchRequest(() => {
      void pump();
    });
    unsubscribed = true;
  }
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
