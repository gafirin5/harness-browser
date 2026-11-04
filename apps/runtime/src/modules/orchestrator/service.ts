import type {
  OrchActorType,
  OrchAgent,
  OrchAgentStatus,
  OrchLogLevel,
  OrchProvider,
  OrchProviderType,
  OrchTask,
  OrchTaskLog,
  OrchTaskPriority,
  OrchTaskStatus
} from '@dorado/shared';
import { computeCost4, decimal4ToInt, intToDecimal4 } from '@dorado/shared';
import { config } from '../../config.js';
import { db, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { sha256 } from '../../lib/validation.js';
import { apiKeyLast4, decryptSecret, encryptSecret, randomToken } from './crypto.js';
import { businessDateInfo, zonedDayEndIso, zonedDayStartIso } from './dashboard.js';
import { requestDispatch } from './events.js';
import { broadcastTask, scheduleSummaryBroadcast } from './hub.js';

const ADMIN_USER_ID = 1;

function uniqueError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // rollback gagal diabaikan
    }
    throw error;
  }
}

/* ------------------------------ providers ------------------------------ */

interface ProviderRow {
  id: number;
  name: string;
  provider_type: OrchProviderType;
  base_url: string;
  api_key_encrypted: string;
  default_model: string;
  cost_per_1k_tokens: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

function providerLast4(row: ProviderRow): string | null {
  try {
    return apiKeyLast4(decryptSecret(row.api_key_encrypted));
  } catch {
    return null;
  }
}

function mapProvider(row: ProviderRow): OrchProvider {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    costPer1kTokens: row.cost_per_1k_tokens,
    isActive: Boolean(row.is_active),
    hasApiKey: true,
    apiKeyLast4: providerLast4(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface ProviderCreateInput {
  name: string;
  providerType: OrchProviderType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  costPer1kTokens: string;
}

export interface ProviderUpdateInput {
  name?: string;
  providerType?: OrchProviderType;
  baseUrl?: string;
  apiKey?: string;
  defaultModel?: string;
  costPer1kTokens?: string;
  isActive?: boolean;
}

export function listProviders(q: string, page: number, pageSize: number): { data: OrchProvider[]; total: number } {
  const filter = q ? 'WHERE lower(name) LIKE ?' : '';
  const params = q ? [`%${q.toLowerCase()}%`] : [];
  const total = (
    db.prepare(`SELECT count(*) AS total FROM providers ${filter}`).get(...params) as { total: number }
  ).total;
  const rows = db
    .prepare(
      `SELECT * FROM providers ${filter}
       ORDER BY is_active DESC, lower(name) ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as ProviderRow[];
  return { data: rows.map(mapProvider), total };
}

export function getProvider(id: number): OrchProvider | null {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as unknown as ProviderRow | undefined;
  return row ? mapProvider(row) : null;
}

export function createProvider(input: ProviderCreateInput): OrchProvider {
  try {
    const row = db
      .prepare(
        `INSERT INTO providers (name, provider_type, base_url, api_key_encrypted, default_model, cost_per_1k_tokens, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         RETURNING *`
      )
      .get(
        input.name,
        input.providerType,
        input.baseUrl,
        encryptSecret(input.apiKey),
        input.defaultModel,
        input.costPer1kTokens,
        nowIso(),
        nowIso()
      ) as unknown as ProviderRow;
    return mapProvider(row);
  } catch (error) {
    if (uniqueError(error)) {
      throw new AppError(422, 'DUPLICATE_PROVIDER', 'Nama provider sudah dipakai.', {
        name: 'Nama provider sudah dipakai.'
      });
    }
    throw error;
  }
}

export function updateProvider(id: number, input: ProviderUpdateInput): OrchProvider {
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as unknown as ProviderRow | undefined;
  if (!existing) throw notFound('Provider tidak ditemukan.');

  if (input.isActive === false) {
    const activeTasks = (
      db
        .prepare("SELECT count(*) AS total FROM tasks WHERE provider_id = ? AND status IN ('QUEUED','RUNNING')")
        .get(id) as { total: number }
    ).total;
    if (activeTasks > 0) {
      throw new AppError(422, 'PROVIDER_IN_USE', 'Provider tidak dapat dinonaktifkan karena masih memiliki task yang aktif.');
    }
    const activeAgents = (
      db.prepare('SELECT count(*) AS total FROM agents WHERE provider_id = ? AND is_active = 1').get(id) as {
        total: number;
      }
    ).total;
    if (activeAgents > 0) {
      throw new AppError(422, 'PROVIDER_IN_USE', 'Provider tidak dapat dinonaktifkan karena masih menjadi provider default agent aktif.');
    }
  }

  try {
    const row = db
      .prepare(
        `UPDATE providers
         SET name = ?, provider_type = ?, base_url = ?, api_key_encrypted = ?, default_model = ?,
             cost_per_1k_tokens = ?, is_active = ?, updated_at = ?
         WHERE id = ?
         RETURNING *`
      )
      .get(
        input.name ?? existing.name,
        input.providerType ?? existing.provider_type,
        input.baseUrl ?? existing.base_url,
        input.apiKey ? encryptSecret(input.apiKey) : existing.api_key_encrypted,
        input.defaultModel ?? existing.default_model,
        input.costPer1kTokens ?? existing.cost_per_1k_tokens,
        input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
        nowIso(),
        id
      ) as unknown as ProviderRow;
    return mapProvider(row);
  } catch (error) {
    if (uniqueError(error)) {
      throw new AppError(422, 'DUPLICATE_PROVIDER', 'Nama provider sudah dipakai.', {
        name: 'Nama provider sudah dipakai.'
      });
    }
    throw error;
  }
}

export function getProviderCredentials(id: number): {
  providerType: OrchProviderType;
  baseUrl: string;
  defaultModel: string;
  costPer1kTokens: string;
  apiKey: string | null;
} | null {
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as unknown as ProviderRow | undefined;
  if (!row) return null;
  return {
    providerType: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    costPer1kTokens: row.cost_per_1k_tokens,
    apiKey: decryptSecret(row.api_key_encrypted)
  };
}

/* -------------------------------- agents -------------------------------- */

interface AgentRow {
  id: number;
  code: string;
  name: string;
  endpoint_url: string;
  provider_id: number;
  provider_name: string | null;
  provider_active: number | null;
  status: OrchAgentStatus;
  max_concurrency: number;
  active_tasks_count: number;
  is_active: number;
  last_heartbeat_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const agentSelect = `
  a.*, p.name AS provider_name, p.is_active AS provider_active
  FROM agents a LEFT JOIN providers p ON p.id = a.provider_id`;

function mapAgent(row: AgentRow): OrchAgent {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    endpointUrl: row.endpoint_url,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerActive: row.provider_active === null ? null : Boolean(row.provider_active),
    status: row.status,
    maxConcurrency: row.max_concurrency,
    activeTasksCount: row.active_tasks_count,
    isActive: Boolean(row.is_active),
    lastHeartbeatAt: row.last_heartbeat_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface AgentCreateInput {
  code: string;
  name: string;
  endpointUrl: string;
  providerId: number;
  maxConcurrency: number;
}

export interface AgentUpdateInput {
  name?: string;
  endpointUrl?: string;
  providerId?: number;
  maxConcurrency?: number;
  isActive?: boolean;
}

function assertActiveProvider(providerId: number): void {
  const provider = db.prepare('SELECT is_active FROM providers WHERE id = ?').get(providerId) as
    | { is_active: number }
    | undefined;
  if (!provider) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Provider tidak ditemukan.', {
      providerId: 'Provider tidak ditemukan.'
    });
  }
  if (!provider.is_active) {
    throw new AppError(422, 'PROVIDER_INACTIVE', 'Provider yang dipilih sudah dinonaktifkan.', {
      providerId: 'Pilih provider yang masih aktif.'
    });
  }
}

export function listAgents(q: string, page: number, pageSize: number): { data: OrchAgent[]; total: number } {
  const filter = q ? 'WHERE lower(a.code) LIKE ? OR lower(a.name) LIKE ?' : '';
  const params = q ? [`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`] : [];
  const total = (
    db.prepare(`SELECT count(*) AS total FROM agents a ${filter}`).get(...params) as { total: number }
  ).total;
  const rows = db
    .prepare(
      `SELECT ${agentSelect} ${filter}
       ORDER BY a.is_active DESC, lower(a.code) ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as AgentRow[];
  return { data: rows.map(mapAgent), total };
}

export function getAgent(id: number): OrchAgent | null {
  const row = db.prepare(`SELECT ${agentSelect} WHERE a.id = ?`).get(id) as unknown as AgentRow | undefined;
  return row ? mapAgent(row) : null;
}



export function createAgent(input: AgentCreateInput): { agent: OrchAgent; token: string } {
  assertActiveProvider(input.providerId);
  const token = `orca_agt_${randomToken(32)}`;
  try {
    const row = db
      .prepare(
        `INSERT INTO agents (provider_id, code, name, endpoint_url, max_concurrency, auth_token_hash, auth_token_encrypted, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         RETURNING id`
      )
      .get(
        input.providerId,
        input.code,
        input.name,
        input.endpointUrl,
        input.maxConcurrency,
        sha256(token),
        encryptSecret(token),
        nowIso(),
        nowIso()
      ) as unknown as { id: number };
    const agent = getAgent(row.id);
    if (!agent) throw new AppError(500, 'INTERNAL', 'Gagal memuat agent.');
    return { agent, token };
  } catch (error) {
    if (uniqueError(error)) {
      throw new AppError(422, 'DUPLICATE_AGENT', 'Kode agent sudah dipakai.', {
        code: 'Kode agent sudah dipakai.'
      });
    }
    throw error;
  }
}

export function updateAgent(id: number, input: AgentUpdateInput): OrchAgent {
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as unknown as AgentRow | undefined;
  if (!existing) throw notFound('Agent tidak ditemukan.');
  if (input.providerId !== undefined) assertActiveProvider(input.providerId);

  if (input.isActive === false) {
    const running = (
      db.prepare("SELECT count(*) AS total FROM tasks WHERE agent_id = ? AND status = 'RUNNING'").get(id) as {
        total: number;
      }
    ).total;
    if (running > 0) {
      throw new AppError(422, 'AGENT_IN_USE', 'Agent tidak dapat dinonaktifkan karena masih memiliki task yang sedang berjalan.');
    }
    const queued = (
      db.prepare("SELECT count(*) AS total FROM tasks WHERE agent_id = ? AND status = 'QUEUED'").get(id) as {
        total: number;
      }
    ).total;
    if (queued > 0) {
      throw new AppError(422, 'AGENT_IN_USE', 'Agent tidak dapat dinonaktifkan karena masih memiliki task dalam antrean.');
    }
  }

  db.prepare(
    `UPDATE agents
     SET name = ?, endpoint_url = ?, provider_id = ?, max_concurrency = ?, is_active = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? existing.name,
    input.endpointUrl ?? existing.endpoint_url,
    input.providerId ?? existing.provider_id,
    input.maxConcurrency ?? existing.max_concurrency,
    input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
    nowIso(),
    id
  );
  recomputeAgentStatus(id);
  const agent = getAgent(id);
  if (!agent) throw notFound('Agent tidak ditemukan.');
  return agent;
}

export function rotateAgentToken(id: number): string {
  const existing = getAgent(id);
  if (!existing) throw notFound('Agent tidak ditemukan.');
  const token = `orca_agt_${randomToken(32)}`;
  db.prepare('UPDATE agents SET auth_token_hash = ?, auth_token_encrypted = ?, updated_at = ? WHERE id = ?').run(
    sha256(token),
    encryptSecret(token),
    nowIso(),
    id
  );
  return token;
}

export function recomputeAgentStatus(agentId: number): OrchAgentStatus | null {
  const agent = db
    .prepare('SELECT is_active, last_error, max_concurrency FROM agents WHERE id = ?')
    .get(agentId) as { is_active: number; last_error: string | null; max_concurrency: number } | undefined;
  if (!agent) return null;
  const count = (
    db.prepare("SELECT count(*) AS total FROM tasks WHERE agent_id = ? AND status = 'RUNNING'").get(agentId) as {
      total: number;
    }
  ).total;
  const status: OrchAgentStatus = !agent.is_active
    ? 'OFFLINE'
    : agent.last_error !== null
      ? 'OFFLINE'
      : count >= agent.max_concurrency
        ? 'BUSY'
        : 'IDLE';
  db.prepare('UPDATE agents SET active_tasks_count = ?, status = ?, updated_at = ? WHERE id = ?').run(
    count,
    status,
    nowIso(),
    agentId
  );
  return status;
}

export function recomputeAllAgents(): number {
  const rows = db.prepare('SELECT id FROM agents').all() as Array<{ id: number }>;
  for (const row of rows) recomputeAgentStatus(row.id);
  return rows.length;
}

export function findAgentByToken(token: string): { id: number; code: string } | null {
  const row = db
    .prepare('SELECT id, code FROM agents WHERE auth_token_hash = ?')
    .get(sha256(token)) as { id: number; code: string } | undefined;
  return row ?? null;
}

export function getAgentDispatchConfig(id: number): {
  id: number;
  code: string;
  endpointUrl: string;
  providerId: number;
  token: string;
} | null {
  const row = db
    .prepare('SELECT id, code, endpoint_url, provider_id, auth_token_encrypted FROM agents WHERE id = ?')
    .get(id) as
    | { id: number; code: string; endpoint_url: string; provider_id: number; auth_token_encrypted: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    endpointUrl: row.endpoint_url,
    providerId: row.provider_id,
    token: decryptSecret(row.auth_token_encrypted)
  };
}

export function setAgentOffline(id: number, message: string): void {
  db.prepare("UPDATE agents SET status = 'OFFLINE', last_error = ?, updated_at = ? WHERE id = ?").run(
    message.slice(0, 1000),
    nowIso(),
    id
  );
}

export function markAgentHealthy(id: number): void {
  db.prepare('UPDATE agents SET last_heartbeat_at = ?, last_error = NULL, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    id
  );
}

export function markStaleAgentsOffline(): number {
  const staleMs = Math.max(config.heartbeatIntervalMs * 3, 90_000);
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const result = db
    .prepare(
      `UPDATE agents
       SET status = 'OFFLINE', last_error = 'Heartbeat kedaluwarsa', updated_at = ?
       WHERE is_active = 1 AND last_heartbeat_at IS NOT NULL
         AND last_heartbeat_at < ? AND status <> 'OFFLINE'`
    )
    .run(nowIso(), cutoff);
  return Number(result.changes);
}

/* --------------------------------- tasks --------------------------------- */

interface TaskRow {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: OrchTaskPriority;
  status: OrchTaskStatus;
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
  agent_active: number | null;
  provider_id: number;
  provider_name: string | null;
  provider_active: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

const taskSelect = `
  t.*,
  a.code AS agent_code, a.name AS agent_name, a.is_active AS agent_active,
  p.name AS provider_name, p.is_active AS provider_active
  FROM tasks t
  LEFT JOIN agents a ON a.id = t.agent_id
  LEFT JOIN providers p ON p.id = t.provider_id`;

function mapTask(row: TaskRow): OrchTask {
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
    agentActive: row.agent_active === null ? null : Boolean(row.agent_active),
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerActive: row.provider_active === null ? null : Boolean(row.provider_active),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TaskCreateInput {
  title: string;
  agentId: number;
  providerId: number;
  priority: OrchTaskPriority;
  prompt: string;
}

export interface TaskFilters {
  status?: OrchTaskStatus;
  agentId?: number;
  providerId?: number;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export interface AgentResultInput {
  status: 'COMPLETED' | 'FAILED';
  tokenUsed?: number;
  result?: string | null;
  error?: { message: string } | null;
}

export function getTask(id: number): OrchTask | null {
  const row = db.prepare(`SELECT ${taskSelect} WHERE t.id = ?`).get(id) as unknown as TaskRow | undefined;
  return row ? mapTask(row) : null;
}



export function getTaskOrThrow(id: number): OrchTask {
  const task = getTask(id);
  if (!task) throw notFound('Task tidak ditemukan.');
  return task;
}

export function listTasks(filters: TaskFilters): { data: OrchTask[]; total: number } {
  const where: string[] = ['1=1'];
  const params: Array<string | number> = [];
  if (filters.status) {
    where.push('t.status = ?');
    params.push(filters.status);
  }
  if (filters.agentId) {
    where.push('t.agent_id = ?');
    params.push(filters.agentId);
  }
  if (filters.providerId) {
    where.push('t.provider_id = ?');
    params.push(filters.providerId);
  }
  if (filters.dateFrom) {
    where.push('t.created_at >= ?');
    params.push(zonedDayStartIso(filters.dateFrom));
  }
  if (filters.dateTo) {
    where.push('t.created_at < ?');
    params.push(zonedDayEndIso(filters.dateTo));
  }
  const whereSql = where.join(' AND ');
  const total = (
    db.prepare(`SELECT count(*) AS total FROM tasks t WHERE ${whereSql}`).get(...params) as { total: number }
  ).total;
  const rows = db
    .prepare(`SELECT ${taskSelect} WHERE ${whereSql} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, filters.pageSize, (filters.page - 1) * filters.pageSize) as unknown as TaskRow[];
  return { data: rows.map(mapTask), total };
}

interface TaskLogRow {
  id: number;
  task_id: number;
  user_id: number | null;
  actor_type: OrchActorType;
  from_status: OrchTaskStatus | null;
  to_status: OrchTaskStatus;
  log_level: OrchLogLevel;
  message: string;
  created_at: string;
}

function mapLog(row: TaskLogRow): OrchTaskLog {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    actorType: row.actor_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    logLevel: row.log_level,
    message: row.message,
    createdAt: row.created_at
  };
}

export function getTaskLogs(taskId: number, afterId: number, limit: number): OrchTaskLog[] {
  const rows = db
    .prepare('SELECT * FROM task_logs WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?')
    .all(taskId, afterId, limit) as unknown as TaskLogRow[];
  return rows.map(mapLog);
}

function insertLog(input: {
  taskId: number;
  userId: number | null;
  actorType: OrchActorType;
  fromStatus: OrchTaskStatus | null;
  toStatus: OrchTaskStatus;
  logLevel: OrchLogLevel;
  message: string;
}): void {
  db.prepare(
    `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.taskId,
    input.userId,
    input.actorType,
    input.fromStatus,
    input.toStatus,
    input.logLevel,
    input.message,
    nowIso()
  );
}

function insertStandaloneLog(taskId: number, level: OrchLogLevel, message: string): void {
  db.prepare(
    `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message, created_at)
     VALUES (?, NULL, 'SYSTEM', 'CANCELLED', 'CANCELLED', ?, ?, ?)`
  ).run(taskId, level, message, nowIso());
}

function nextTaskCode(): string {
  const info = businessDateInfo();
  const row = db
    .prepare(
      `INSERT INTO task_code_sequences (business_date, last_value)
       VALUES (?, 1)
       ON CONFLICT(business_date) DO UPDATE SET last_value = task_code_sequences.last_value + 1
       RETURNING last_value`
    )
    .get(info.businessDate) as { last_value: number };
  if (row.last_value > 9999) {
    throw new AppError(503, 'SEQUENCE_EXHAUSTED', 'Kuota nomor task harian habis. Coba lagi besok.');
  }
  return `TSK-${info.ymd}-${String(row.last_value).padStart(4, '0')}`;
}

function insertTaskTx(
  input: TaskCreateInput,
  options: { clientRequestId?: string | null; retryOf?: { id: number; code: string }; allowOffline?: boolean } = {}
): { id: number; created: boolean } {
  if (options.clientRequestId) {
    const existing = db.prepare('SELECT id FROM tasks WHERE client_request_id = ?').get(options.clientRequestId) as
      | { id: number }
      | undefined;
    if (existing) return { id: existing.id, created: false };
  }

  const agent = db
    .prepare('SELECT id, code, status, is_active FROM agents WHERE id = ?')
    .get(input.agentId) as { id: number; code: string; status: string; is_active: number } | undefined;
  if (!agent) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Agent tujuan tidak ditemukan.', {
      agentId: 'Agent tidak ditemukan.'
    });
  }
  if (!agent.is_active) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Agent tujuan sudah dinonaktifkan.', {
      agentId: 'Pilih agent yang masih aktif.'
    });
  }
  if (agent.status === 'OFFLINE' && !options.allowOffline) {
    throw new AppError(422, 'AGENT_OFFLINE', 'Agent tujuan sedang OFFLINE. Pilih agent lain.', {
      agentId: 'Agent sedang OFFLINE.'
    });
  }

  const provider = db
    .prepare('SELECT id, is_active, cost_per_1k_tokens FROM providers WHERE id = ?')
    .get(input.providerId) as { id: number; is_active: number; cost_per_1k_tokens: string } | undefined;
  if (!provider) {
    throw new AppError(422, 'VALIDATION_ERROR', 'Provider tidak ditemukan.', {
      providerId: 'Provider tidak ditemukan.'
    });
  }
  if (!provider.is_active) {
    throw new AppError(422, 'PROVIDER_INACTIVE', 'Provider yang dipilih sudah dinonaktifkan.', {
      providerId: 'Pilih provider yang masih aktif.'
    });
  }

  const code = nextTaskCode();
  try {
    const inserted = db
      .prepare(
        `INSERT INTO tasks (code, agent_id, provider_id, title, prompt, priority, status,
                            token_used, cost_per_1k_snapshot, cost_usd, retry_of_task_id, client_request_id,
                            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', 0, ?, '0.0000', ?, ?, ?, ?)
         RETURNING id`
      )
      .get(
        code,
        input.agentId,
        input.providerId,
        input.title,
        input.prompt,
        input.priority,
        provider.cost_per_1k_tokens,
        options.retryOf?.id ?? null,
        options.clientRequestId ?? null,
        nowIso(),
        nowIso()
      ) as { id: number };
    insertLog({
      taskId: inserted.id,
      userId: ADMIN_USER_ID,
      actorType: 'USER',
      fromStatus: null,
      toStatus: 'QUEUED',
      logLevel: 'INFO',
      message: options.retryOf
        ? `Retry dari ${options.retryOf.code}. Task masuk antrean.`
        : 'Task dibuat dan masuk antrean.'
    });
    return { id: inserted.id, created: true };
  } catch (error) {
    if (uniqueError(error) && options.clientRequestId) {
      const existing = db
        .prepare('SELECT id FROM tasks WHERE client_request_id = ?')
        .get(options.clientRequestId) as { id: number } | undefined;
      if (existing) return { id: existing.id, created: false };
    }
    throw error;
  }
}

function afterTaskChange(task: OrchTask): void {
  scheduleSummaryBroadcast();
  broadcastTask({ id: task.id, code: task.code, status: task.status });
  requestDispatch();
}

export function createTask(
  input: TaskCreateInput,
  clientRequestId?: string | null
): { task: OrchTask; created: boolean } {
  const result = transaction(() => insertTaskTx(input, { clientRequestId: clientRequestId ?? null }));
  const task = getTaskOrThrow(result.id);
  if (result.created) afterTaskChange(task);
  return { task, created: result.created };
}

export function retryTask(taskId: number, clientRequestId?: string | null): OrchTask {
  const original = getTaskOrThrow(taskId);
  if (!['FAILED', 'CANCELLED'].includes(original.status)) {
    throw new AppError(422, 'INVALID_TRANSITION', 'Hanya task FAILED atau CANCELLED yang dapat dijalankan ulang.');
  }
  const result = transaction(() =>
    insertTaskTx(
      {
        title: original.title,
        prompt: original.prompt,
        priority: original.priority,
        agentId: original.agentId,
        providerId: original.providerId
      },
      { retryOf: { id: original.id, code: original.code }, allowOffline: true, clientRequestId: clientRequestId ?? null }
    )
  );
  const task = getTaskOrThrow(result.id);
  if (result.created) afterTaskChange(task);
  return task;
}

export function cancelTask(taskId: number, reason: string): { task: OrchTask; wasRunning: boolean } {
  const result = transaction(() => {
    const row = db.prepare('SELECT id, code, status, agent_id FROM tasks WHERE id = ?').get(taskId) as
      | { id: number; code: string; status: OrchTaskStatus; agent_id: number }
      | undefined;
    if (!row) throw notFound('Task tidak ditemukan.');
    if (row.status === 'COMPLETED') {
      throw new AppError(422, 'INVALID_TRANSITION', 'Task yang sudah selesai tidak dapat dibatalkan.');
    }
    if (!['QUEUED', 'RUNNING'].includes(row.status)) {
      throw new AppError(422, 'INVALID_TRANSITION', `Task dengan status ${row.status} tidak dapat dibatalkan.`);
    }
    const wasRunning = row.status === 'RUNNING';
    db.prepare(
      "UPDATE tasks SET status = 'CANCELLED', cancel_reason = ?, finished_at = ?, updated_at = ? WHERE id = ?"
    ).run(reason, nowIso(), nowIso(), taskId);
    if (wasRunning) recomputeAgentStatus(row.agent_id);
    insertLog({
      taskId,
      userId: ADMIN_USER_ID,
      actorType: 'USER',
      fromStatus: row.status,
      toStatus: 'CANCELLED',
      logLevel: 'WARN',
      message: `Task dibatalkan: ${reason}`
    });
    return { id: row.id, code: row.code, agentId: row.agent_id, wasRunning };
  });

  const task = getTaskOrThrow(taskId);
  afterTaskChange(task);
  if (result.wasRunning) {
    void notifyAgentCancel(taskId, result.agentId, result.code, reason);
  }
  return { task, wasRunning: result.wasRunning };
}

async function notifyAgentCancel(taskId: number, agentId: number, code: string, reason: string): Promise<void> {
  try {
    const agent = getAgentDispatchConfig(agentId);
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
      insertStandaloneLog(taskId, 'INFO', 'Notifikasi pembatalan terkirim ke agent.');
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    insertStandaloneLog(taskId, 'WARN', `Notifikasi pembatalan gagal dikirim: ${(error as Error).message}`);
  } finally {
    scheduleSummaryBroadcast();
  }
}

export function applyAgentResult(
  agentId: number,
  code: string,
  input: AgentResultInput
): { taskId: number; noop: boolean; status: OrchTaskStatus } {
  const result = transaction(() => {
    const row = db
      .prepare('SELECT id, agent_id, status, cost_per_1k_snapshot FROM tasks WHERE code = ?')
      .get(code) as
      | { id: number; agent_id: number; status: OrchTaskStatus; cost_per_1k_snapshot: string }
      | undefined;
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
      if (input.tokenUsed === undefined) {
        throw new AppError(422, 'VALIDATION_ERROR', 'tokenUsed wajib diisi untuk task COMPLETED.', {
          tokenUsed: 'Token wajib diisi.'
        });
      }
      const cost = intToDecimal4(
        computeCost4(decimal4ToInt(row.cost_per_1k_snapshot), input.tokenUsed)
      );
      db.prepare(
        `UPDATE tasks
         SET status = 'COMPLETED', token_used = ?, cost_usd = ?, result = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(input.tokenUsed, cost, input.result ?? null, nowIso(), nowIso(), row.id);
      insertLog({
        taskId: row.id,
        userId: null,
        actorType: 'AGENT',
        fromStatus: 'RUNNING',
        toStatus: 'COMPLETED',
        logLevel: 'INFO',
        message: `Task selesai. Token: ${input.tokenUsed} · Biaya: $${cost}`
      });
    } else {
      const message = input.error?.message;
      if (!message) {
        throw new AppError(422, 'VALIDATION_ERROR', 'Pesan error wajib diisi untuk task FAILED.', {
          error: 'Pesan error wajib diisi.'
        });
      }
      const tokens = input.tokenUsed ?? 0;
      const cost =
        tokens > 0 ? intToDecimal4(computeCost4(decimal4ToInt(row.cost_per_1k_snapshot), tokens)) : '0.0000';
      db.prepare(
        `UPDATE tasks
         SET status = 'FAILED', token_used = ?, cost_usd = ?, error_message = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`
      ).run(tokens, cost, message, nowIso(), nowIso(), row.id);
      insertLog({
        taskId: row.id,
        userId: null,
        actorType: 'AGENT',
        fromStatus: 'RUNNING',
        toStatus: 'FAILED',
        logLevel: 'ERROR',
        message: `Task gagal: ${message}`
      });
    }

    recomputeAgentStatus(agentId);
    return { id: row.id, noop: false, status: input.status };
  });

  scheduleSummaryBroadcast();
  broadcastTask({ id: result.id, code, status: result.status });
  if (!result.noop) requestDispatch();
  return { taskId: result.id, noop: result.noop, status: result.status };
}

/* --------------------- dispatcher helper queries --------------------- */

export interface QueueTask {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: number;
  agentId: number;
  providerId: number;
  createdAt: string;
}

export function claimNextTask(): QueueTask | null {
  return transaction(() => {
    const row = db
      .prepare(
        `SELECT t.id, t.code, t.title, t.prompt, t.priority, t.agent_id, t.provider_id, t.created_at
         FROM tasks t
         JOIN agents a ON a.id = t.agent_id
         WHERE t.status = 'QUEUED'
           AND a.is_active = 1
           AND a.status <> 'OFFLINE'
           AND a.active_tasks_count < a.max_concurrency
         ORDER BY t.priority DESC, t.created_at ASC, t.id ASC
         LIMIT 1`
      )
      .get() as
      | {
          id: number;
          code: string;
          title: string;
          prompt: string;
          priority: number;
          agent_id: number;
          provider_id: number;
          created_at: string;
        }
      | undefined;
    if (!row) return null;

    const agent = db
      .prepare('SELECT active_tasks_count, max_concurrency, status, is_active FROM agents WHERE id = ?')
      .get(row.agent_id) as
      | { active_tasks_count: number; max_concurrency: number; status: string; is_active: number }
      | undefined;
    if (!agent || !agent.is_active || agent.status === 'OFFLINE' || agent.active_tasks_count >= agent.max_concurrency) {
      return null;
    }

    const updated = db
      .prepare(
        "UPDATE tasks SET status = 'RUNNING', started_at = ?, updated_at = ? WHERE id = ? AND status = 'QUEUED' RETURNING id"
      )
      .get(nowIso(), nowIso(), row.id) as { id: number } | undefined;
    if (!updated) return null;
    insertLog({
      taskId: row.id,
      userId: null,
      actorType: 'SYSTEM',
      fromStatus: 'QUEUED',
      toStatus: 'RUNNING',
      logLevel: 'INFO',
      message: 'Task dikirim ke agent.'
    });
    recomputeAgentStatus(row.agent_id);
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

export function markDispatchFailed(task: QueueTask, reason: string): void {
  transaction(() => {
    const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id) as { status: string } | undefined;
    if (row?.status !== 'RUNNING') return;
    db.prepare(
      "UPDATE tasks SET status = 'FAILED', error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?"
    ).run(reason.slice(0, 2000), nowIso(), nowIso(), task.id);
    insertLog({
      taskId: task.id,
      userId: null,
      actorType: 'SYSTEM',
      fromStatus: 'RUNNING',
      toStatus: 'FAILED',
      logLevel: 'ERROR',
      message: `Gagal menghubungi endpoint agent. Task ditandai FAILED. (${reason})`
    });
    recomputeAgentStatus(task.agentId);
  });
  scheduleSummaryBroadcast();
  broadcastTask({ id: task.id, code: task.code, status: 'FAILED' });
}

export function failStaleTasks(): number {
  const cutoff = new Date(Date.now() - config.taskMaxDurationMs).toISOString();
  const stale = db
    .prepare("SELECT id, code, agent_id FROM tasks WHERE status = 'RUNNING' AND started_at IS NOT NULL AND started_at < ?")
    .all(cutoff) as Array<{ id: number; code: string; agent_id: number }>;
  for (const task of stale) {
    transaction(() => {
      const row = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id) as { status: string } | undefined;
      if (row?.status !== 'RUNNING') return;
      db.prepare(
        "UPDATE tasks SET status = 'FAILED', error_message = 'Melewati batas waktu eksekusi.', finished_at = ?, updated_at = ? WHERE id = ?"
      ).run(nowIso(), nowIso(), task.id);
      insertLog({
        taskId: task.id,
        userId: null,
        actorType: 'SYSTEM',
        fromStatus: 'RUNNING',
        toStatus: 'FAILED',
        logLevel: 'ERROR',
        message: 'Task melewati batas waktu eksekusi dan ditandai FAILED.'
      });
      recomputeAgentStatus(task.agent_id);
    });
    broadcastTask({ id: task.id, code: task.code, status: 'FAILED' });
  }
  return stale.length;
}