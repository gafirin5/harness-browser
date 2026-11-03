import type { PoolClient } from 'pg';
import type { Task, TaskLog, TaskStatus } from '@orca/shared';
import { computeCost4, decimal4ToInt, intToDecimal4 } from '@orca/shared';
import { config } from '../../config.js';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { getAgentDispatchConfig, recomputeAgentStatus } from '../agents/service.js';
import { AppError, notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/format.js';
import { requestDispatch } from '../../lib/queue-events.js';
import { scheduleSummaryBroadcast, broadcastTask } from '../../realtime/hub.js';

interface TaskRow {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: 1 | 2 | 3;
  status: TaskStatus;
  token_used: number;
  cost_per_1k_snapshot: string;
  cost_usd: string;
  cancel_reason: string | null;
  error_message: string | null;
  result: string | null;
  retry_of_task_id: number | null;
  agent_id: number;
  agent_code: string | null;
  agent_name: string | null;
  agent_active: boolean | null;
  provider_id: number;
  provider_name: string | null;
  provider_active: boolean | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface TaskLogRow {
  id: number;
  task_id: number;
  user_id: number | null;
  actor_type: 'USER' | 'SYSTEM' | 'AGENT';
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  log_level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  created_at: Date;
}

export interface TaskCreateInput {
  title: string;
  agent_id: number;
  provider_id: number;
  priority: 1 | 2 | 3;
  prompt: string;
}

export interface AgentResultInput {
  status: 'COMPLETED' | 'FAILED';
  token_used?: number;
  result?: string | null;
  error?: { message: string } | null;
}

export interface TaskFilters {
  status?: TaskStatus;
  agent_id?: number;
  provider_id?: number;
  date_from?: string;
  date_to?: string;
  page: number;
  page_size: number;
}

const selectColumns = `
  t.id, t.code, t.title, t.prompt, t.priority, t.status, t.token_used,
  t.cost_per_1k_snapshot::text AS cost_per_1k_snapshot, t.cost_usd::text AS cost_usd,
  t.cancel_reason, t.error_message, t.result, t.retry_of_task_id,
  t.agent_id, a.code AS agent_code, a.name AS agent_name, a.is_active AS agent_active,
  t.provider_id, p.name AS provider_name, p.is_active AS provider_active,
  t.started_at, t.finished_at, t.created_at, t.updated_at`;

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    prompt: row.prompt,
    priority: row.priority,
    status: row.status,
    tokenUsed: row.token_used,
    costPer1kSnapshot: row.cost_per_1k_snapshot,
    costUsd: row.cost_usd,
    cancelReason: row.cancel_reason,
    errorMessage: row.error_message,
    result: row.result,
    retryOfTaskId: row.retry_of_task_id,
    agentId: row.agent_id,
    agentCode: row.agent_code,
    agentName: row.agent_name,
    agentActive: row.agent_active,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerActive: row.provider_active,
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

function mapLog(row: TaskLogRow): TaskLog {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    actorType: row.actor_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    logLevel: row.log_level,
    message: row.message,
    createdAt: toIso(row.created_at) ?? new Date().toISOString()
  };
}

export async function getTask(id: number): Promise<Task | null> {
  const row = await queryOne<TaskRow>(
    `SELECT ${selectColumns} FROM tasks t
     LEFT JOIN agents a ON a.id = t.agent_id
     LEFT JOIN providers p ON p.id = t.provider_id
     WHERE t.id = $1`,
    [id]
  );
  return row ? mapTask(row) : null;
}

export async function getTaskOrThrow(id: number): Promise<Task> {
  const task = await getTask(id);
  if (!task) throw notFound('Task tidak ditemukan.');
  return task;
}

export async function listTasks(filters: TaskFilters): Promise<{ data: Task[]; total: number }> {
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  let index = 1;

  if (filters.status) {
    where.push(`t.status = $${index++}`);
    params.push(filters.status);
  }
  if (filters.agent_id) {
    where.push(`t.agent_id = $${index++}`);
    params.push(filters.agent_id);
  }
  if (filters.provider_id) {
    where.push(`t.provider_id = $${index++}`);
    params.push(filters.provider_id);
  }
  if (filters.date_from) {
    const dateParam = index++;
    const tzParam = index++;
    where.push(`t.created_at >= ($${dateParam}::date)::timestamp AT TIME ZONE $${tzParam}`);
    params.push(filters.date_from, config.appTimezone);
  }
  if (filters.date_to) {
    const dateParam = index++;
    const tzParam = index++;
    where.push(`t.created_at < (($${dateParam}::date + 1)::timestamp AT TIME ZONE $${tzParam})`);
    params.push(filters.date_to, config.appTimezone);
  }

  const whereSql = where.join(' AND ');
  const countRow = await queryOne<{ total: string }>(`SELECT count(*)::text AS total FROM tasks t WHERE ${whereSql}`, params);
  const rows = await query<TaskRow>(
    `SELECT ${selectColumns} FROM tasks t
     LEFT JOIN agents a ON a.id = t.agent_id
     LEFT JOIN providers p ON p.id = t.provider_id
     WHERE ${whereSql}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $${index} OFFSET $${index + 1}`,
    [...params, filters.page_size, (filters.page - 1) * filters.page_size]
  );

  return { data: rows.map(mapTask), total: Number(countRow?.total ?? 0) };
}

export async function getTaskLogs(taskId: number, afterId: number, limit: number): Promise<TaskLog[]> {
  const rows = await query<TaskLogRow>(
    `SELECT id, task_id, user_id, actor_type, from_status, to_status, log_level, message, created_at
     FROM task_logs
     WHERE task_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT $3`,
    [taskId, afterId, limit]
  );
  return rows.map(mapLog);
}

async function insertLog(
  client: PoolClient,
  input: {
    taskId: number;
    userId: number | null;
    actorType: 'USER' | 'SYSTEM' | 'AGENT';
    fromStatus: TaskStatus | null;
    toStatus: TaskStatus;
    logLevel: 'INFO' | 'WARN' | 'ERROR';
    message: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.taskId, input.userId, input.actorType, input.fromStatus, input.toStatus, input.logLevel, input.message]
  );
}

async function insertStandaloneLog(
  taskId: number,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string
): Promise<void> {
  await query(
    `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message)
     VALUES ($1, NULL, 'SYSTEM', 'CANCELLED', 'CANCELLED', $2, $3)`,
    [taskId, level, message]
  );
}

async function nextTaskCode(client: PoolClient): Promise<string> {
  const dateRow = await client.query<{ ymd: string; business_date: string }>(
    `SELECT to_char(now() AT TIME ZONE $1, 'YYYYMMDD') AS ymd,
            to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS business_date`,
    [config.appTimezone]
  );
  const info = dateRow.rows[0];
  if (!info) throw new AppError(500, 'INTERNAL', 'Gagal menentukan tanggal bisnis.');

  const seqRow = await client.query<{ last_value: number }>(
    `INSERT INTO task_code_sequences (business_date, last_value)
     VALUES ($1::date, 1)
     ON CONFLICT (business_date)
     DO UPDATE SET last_value = task_code_sequences.last_value + 1
     RETURNING last_value`,
    [info.business_date]
  );
  const seq = seqRow.rows[0]?.last_value;
  if (!seq) throw new AppError(500, 'INTERNAL', 'Gagal membuat nomor task.');
  if (seq > 9999) {
    throw new AppError(503, 'SEQUENCE_EXHAUSTED', 'Kuota nomor task harian habis. Coba lagi besok.');
  }
  return `TSK-${info.ymd}-${String(seq).padStart(4, '0')}`;
}

async function insertTaskTx(
  client: PoolClient,
  userId: number,
  input: TaskCreateInput,
  options: {
    clientRequestId?: string | null;
    retryOf?: { id: number; code: string };
    allowOffline?: boolean;
  } = {}
): Promise<{ id: number; created: boolean }> {
  if (options.clientRequestId) {
    const existing = await client.query<{ id: number }>('SELECT id FROM tasks WHERE client_request_id = $1', [
      options.clientRequestId
    ]);
    if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  }

  const agent = await client.query<{ id: number; code: string; status: string; is_active: boolean }>(
    'SELECT id, code, status, is_active FROM agents WHERE id = $1',
    [input.agent_id]
  );
  const agentRow = agent.rows[0];
  if (!agentRow) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Agent tujuan tidak ditemukan.', { agent_id: 'Agent tidak ditemukan.' });
  }
  if (!agentRow.is_active) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Agent tujuan sudah dinonaktifkan.', {
      agent_id: 'Pilih agent yang masih aktif.'
    });
  }
  if (agentRow.status === 'OFFLINE' && !options.allowOffline) {
    throw new AppError(422, 'AGENT_OFFLINE', 'Agent tujuan sedang OFFLINE. Pilih agent lain.', {
      agent_id: 'Agent sedang OFFLINE.'
    });
  }

  const provider = await client.query<{ id: number; is_active: boolean; cost_per_1k_tokens: string }>(
    'SELECT id, is_active, cost_per_1k_tokens::text AS cost_per_1k_tokens FROM providers WHERE id = $1',
    [input.provider_id]
  );
  const providerRow = provider.rows[0];
  if (!providerRow) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Provider tidak ditemukan.', { provider_id: 'Provider tidak ditemukan.' });
  }
  if (!providerRow.is_active) {
    throw new AppError(422, 'PROVIDER_INACTIVE', 'Provider yang dipilih sudah dinonaktifkan.', {
      provider_id: 'Pilih provider yang masih aktif.'
    });
  }

  const code = await nextTaskCode(client);
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO tasks (code, user_id, agent_id, provider_id, title, prompt, priority, status,
                        token_used, cost_per_1k_snapshot, cost_usd, retry_of_task_id, client_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', 0, $8, 0, $9, $10)
     ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      code,
      userId,
      input.agent_id,
      input.provider_id,
      input.title,
      input.prompt,
      input.priority,
      providerRow.cost_per_1k_tokens,
      options.retryOf?.id ?? null,
      options.clientRequestId ?? null
    ]
  );

  const insertedRow = inserted.rows[0];
  if (!insertedRow) {
    const existing = await client.query<{ id: number }>('SELECT id FROM tasks WHERE client_request_id = $1', [
      options.clientRequestId
    ]);
    if (!existing.rows[0]) throw new AppError(500, 'INTERNAL', 'Gagal menyimpan task.');
    return { id: existing.rows[0].id, created: false };
  }

  await insertLog(client, {
    taskId: insertedRow.id,
    userId,
    actorType: 'USER',
    fromStatus: null,
    toStatus: 'QUEUED',
    logLevel: 'INFO',
    message: options.retryOf
      ? `Retry dari ${options.retryOf.code}. Task masuk antrean.`
      : 'Task dibuat dan masuk antrean.'
  });

  return { id: insertedRow.id, created: true };
}

function afterTaskChange(status: TaskStatus, id: number, code: string): void {
  scheduleSummaryBroadcast();
  broadcastTask({ id, code, status });
  requestDispatch();
}

export async function createTask(
  userId: number,
  input: TaskCreateInput,
  clientRequestId?: string | null
): Promise<{ task: Task; created: boolean }> {
  const result = await withTransaction((client) =>
    insertTaskTx(client, userId, input, { clientRequestId: clientRequestId ?? null })
  );
  const task = await getTaskOrThrow(result.id);
  if (result.created) afterTaskChange('QUEUED', task.id, task.code);
  return { task, created: result.created };
}

export async function retryTask(taskId: number, userId: number): Promise<Task> {
  const original = await getTaskOrThrow(taskId);
  if (!['FAILED', 'CANCELLED'].includes(original.status)) {
    throw new AppError(422, 'INVALID_TRANSITION', 'Hanya task FAILED atau CANCELLED yang dapat dijalankan ulang.');
  }

  const result = await withTransaction((client) =>
    insertTaskTx(
      client,
      userId,
      {
        title: original.title,
        prompt: original.prompt,
        priority: original.priority,
        agent_id: original.agentId,
        provider_id: original.providerId
      },
      { retryOf: { id: original.id, code: original.code }, allowOffline: true }
    )
  );
  const task = await getTaskOrThrow(result.id);
  afterTaskChange('QUEUED', task.id, task.code);
  return task;
}

export async function cancelTask(
  taskId: number,
  userId: number,
  reason: string
): Promise<{ task: Task; agentId: number; code: string; wasRunning: boolean }> {
  const result = await withTransaction(async (client) => {
    const selected = await client.query<{ id: number; code: string; status: TaskStatus; agent_id: number }>(
      'SELECT id, code, status, agent_id FROM tasks WHERE id = $1 FOR UPDATE',
      [taskId]
    );
    const row = selected.rows[0];
    if (!row) throw notFound('Task tidak ditemukan.');

    if (row.status === 'COMPLETED') {
      throw new AppError(422, 'INVALID_TRANSITION', 'Task yang sudah selesai tidak dapat dibatalkan.');
    }
    if (!['QUEUED', 'RUNNING'].includes(row.status)) {
      throw new AppError(422, 'INVALID_TRANSITION', `Task dengan status ${row.status} tidak dapat dibatalkan.`);
    }

    const wasRunning = row.status === 'RUNNING';
    await client.query(
      `UPDATE tasks
       SET status = 'CANCELLED', cancel_reason = $1, finished_at = now(), updated_at = now()
       WHERE id = $2`,
      [reason, taskId]
    );

    if (wasRunning) {
      await recomputeAgentStatus(row.agent_id, client);
    }

    await insertLog(client, {
      taskId,
      userId,
      actorType: 'USER',
      fromStatus: row.status,
      toStatus: 'CANCELLED',
      logLevel: 'WARN',
      message: `Task dibatalkan: ${reason}`
    });

    return { id: row.id, code: row.code, agentId: row.agent_id, wasRunning };
  });

  const task = await getTaskOrThrow(taskId);
  afterTaskChange('CANCELLED', task.id, task.code);
  if (result.wasRunning) {
    void notifyAgentCancel(taskId, result.agentId, result.code, reason);
  }
  return { task, agentId: result.agentId, code: result.code, wasRunning: result.wasRunning };
}

async function notifyAgentCancel(taskId: number, agentId: number, code: string, reason: string): Promise<void> {
  try {
    const agent = await getAgentDispatchConfig(agentId);
    if (!agent) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.dispatchTimeoutMs);
    try {
      const response = await fetch(`${agent.endpointUrl.replace(/\/$/, '')}/tasks/${encodeURIComponent(code)}/cancel`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${agent.token}`
        },
        body: JSON.stringify({ reason }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await insertStandaloneLog(taskId, 'INFO', 'Notifikasi pembatalan terkirim ke agent.');
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    await insertStandaloneLog(
      taskId,
      'WARN',
      `Notifikasi pembatalan gagal dikirim: ${(error as Error).message}`
    );
  } finally {
    scheduleSummaryBroadcast();
  }
}

export async function applyAgentResult(
  agentId: number,
  code: string,
  input: AgentResultInput
): Promise<{ taskId: number; noop: boolean; status: TaskStatus }> {
  const result = await withTransaction(async (client) => {
    const selected = await client.query<{
      id: number;
      agent_id: number;
      status: TaskStatus;
      cost_per_1k_snapshot: string;
    }>(
      `SELECT id, agent_id, status, cost_per_1k_snapshot::text AS cost_per_1k_snapshot
       FROM tasks WHERE code = $1 FOR UPDATE`,
      [code]
    );
    const row = selected.rows[0];
    if (!row) throw notFound('Task tidak ditemukan.');
    if (row.agent_id !== agentId) throw new AppError(403, 'FORBIDDEN', 'Task ini bukan milik agent tersebut.');

    if (row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'CANCELLED') {
      if (row.status === input.status) return { id: row.id, noop: true, status: row.status };
      throw new AppError(422, 'INVALID_TRANSITION', `Task sudah berstatus ${row.status} dan tidak dapat diubah.`);
    }
    if (row.status !== 'RUNNING') {
      throw new AppError(422, 'INVALID_TRANSITION', 'Hanya task RUNNING yang dapat menerima hasil.');
    }

    if (input.status === 'COMPLETED') {
      if (input.token_used === undefined) {
        throw new AppError(422, 'VALIDATION_ERROR', 'token_used wajib diisi untuk task COMPLETED.', {
          token_used: 'Token wajib diisi.'
        });
      }
      const cost4 = computeCost4(decimal4ToInt(row.cost_per_1k_snapshot), input.token_used);
      const cost = intToDecimal4(cost4);
      await client.query(
        `UPDATE tasks
         SET status = 'COMPLETED', token_used = $1, cost_usd = $2, result = $3, finished_at = now(), updated_at = now()
         WHERE id = $4`,
        [input.token_used, cost, input.result ?? null, row.id]
      );
      await insertLog(client, {
        taskId: row.id,
        userId: null,
        actorType: 'AGENT',
        fromStatus: 'RUNNING',
        toStatus: 'COMPLETED',
        logLevel: 'INFO',
        message: `Task selesai. Token: ${input.token_used} · Biaya: $${cost}`
      });
    } else {
      const message = input.error?.message;
      if (!message) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Pesan error wajib diisi untuk task FAILED.', {
          error: 'Pesan error wajib diisi.'
        });
      }
      const tokens = input.token_used ?? 0;
      const cost = tokens > 0 ? intToDecimal4(computeCost4(decimal4ToInt(row.cost_per_1k_snapshot), tokens)) : '0.0000';
      await client.query(
        `UPDATE tasks
         SET status = 'FAILED', token_used = $1, cost_usd = $2, error_message = $3, finished_at = now(), updated_at = now()
         WHERE id = $4`,
        [tokens, cost, message, row.id]
      );
      await insertLog(client, {
        taskId: row.id,
        userId: null,
        actorType: 'AGENT',
        fromStatus: 'RUNNING',
        toStatus: 'FAILED',
        logLevel: 'ERROR',
        message: `Task gagal: ${message}`
      });
    }

    await recomputeAgentStatus(agentId, client);
    return { id: row.id, noop: false, status: input.status };
  });

  scheduleSummaryBroadcast();
  broadcastTask({ id: result.id, code, status: result.status });
  if (!result.noop) requestDispatch();
  return { taskId: result.id, noop: result.noop, status: result.status };
}
