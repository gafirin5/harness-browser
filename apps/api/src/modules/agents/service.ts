import type { PoolClient } from 'pg';
import type { Agent, AgentStatus } from '@orca/shared';
import { pool, query, queryOne } from '../../db/pool.js';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/format.js';

interface AgentRow {
  id: number;
  code: string;
  name: string;
  endpoint_url: string;
  provider_id: number;
  provider_name: string | null;
  provider_active: boolean | null;
  status: AgentStatus;
  max_concurrency: number;
  active_tasks_count: number;
  is_active: boolean;
  last_heartbeat_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AgentCreateInput {
  code: string;
  name: string;
  endpoint_url: string;
  provider_id: number;
  max_concurrency: number;
}

export interface AgentUpdateInput {
  name?: string;
  endpoint_url?: string;
  provider_id?: number;
  max_concurrency?: number;
  is_active?: boolean;
}

const selectColumns = `
  a.id, a.code, a.name, a.endpoint_url, a.provider_id, a.status, a.max_concurrency,
  a.active_tasks_count, a.is_active, a.last_heartbeat_at, a.last_error, a.created_at, a.updated_at,
  p.name AS provider_name, p.is_active AS provider_active`;

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    endpointUrl: row.endpoint_url,
    providerId: row.provider_id,
    providerName: row.provider_name,
    providerActive: row.provider_active,
    status: row.status,
    maxConcurrency: row.max_concurrency,
    activeTasksCount: row.active_tasks_count,
    isActive: row.is_active,
    lastHeartbeatAt: toIso(row.last_heartbeat_at),
    lastError: row.last_error,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

export async function listAgents(
  q: string,
  page: number,
  pageSize: number
): Promise<{ data: Agent[]; total: number }> {
  const pattern = `%${q.toLowerCase()}%`;
  const filter = q ? `WHERE lower(a.code) LIKE $1 OR lower(a.name) LIKE $1` : '';
  const params: unknown[] = q ? [pattern] : [];

  const countRow = await queryOne<{ total: string }>(
    `SELECT count(*)::text AS total FROM agents a ${filter}`,
    params
  );

  const rows = await query<AgentRow>(
    `SELECT ${selectColumns}
     FROM agents a
     LEFT JOIN providers p ON p.id = a.provider_id
     ${filter}
     ORDER BY a.is_active DESC, lower(a.code) ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { data: rows.map(mapAgent), total: Number(countRow?.total ?? 0) };
}

export async function getAgent(id: number): Promise<Agent | null> {
  const row = await queryOne<AgentRow>(
    `SELECT ${selectColumns} FROM agents a LEFT JOIN providers p ON p.id = a.provider_id WHERE a.id = $1`,
    [id]
  );
  return row ? mapAgent(row) : null;
}

async function assertActiveProvider(providerId: number): Promise<void> {
  const provider = await queryOne<{ is_active: boolean }>('SELECT is_active FROM providers WHERE id = $1', [providerId]);
  if (!provider) throw new AppError(422, 'VALIDATION_ERROR', 'Provider tidak ditemukan.', { provider_id: 'Provider tidak ditemukan.' });
  if (!provider.is_active) {
    throw new AppError(422, 'PROVIDER_INACTIVE', 'Provider yang dipilih sudah dinonaktifkan.', {
      provider_id: 'Pilih provider yang masih aktif.'
    });
  }
}

export async function createAgent(
  userId: number,
  input: AgentCreateInput
): Promise<{ agent: Agent; token: string }> {
  await assertActiveProvider(input.provider_id);
  const token = `orca_agt_${randomToken(32)}`;
  const row = await queryOne<{ id: number }>(
    `INSERT INTO agents (user_id, provider_id, code, name, endpoint_url, max_concurrency, auth_token_hash, auth_token_encrypted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      input.provider_id,
      input.code,
      input.name,
      input.endpoint_url,
      input.max_concurrency,
      sha256(token),
      encryptSecret(token)
    ]
  );
  if (!row) throw new AppError(500, 'INTERNAL', 'Gagal menyimpan agent.');
  const agent = await getAgent(row.id);
  if (!agent) throw new AppError(500, 'INTERNAL', 'Gagal memuat agent.');
  return { agent, token };
}

export async function updateAgent(id: number, input: AgentUpdateInput): Promise<Agent> {
  const existing = await getAgent(id);
  if (!existing) throw notFound('Agent tidak ditemukan.');

  if (input.provider_id !== undefined) {
    await assertActiveProvider(input.provider_id);
  }

  if (input.is_active === false) {
    const usage = await queryOne<{ running: number; queued: number }>(
      `SELECT
         count(*) FILTER (WHERE status = 'RUNNING')::int AS running,
         count(*) FILTER (WHERE status = 'QUEUED')::int AS queued
       FROM tasks WHERE agent_id = $1`,
      [id]
    );
    if ((usage?.running ?? 0) > 0) {
      throw new AppError(422, 'AGENT_IN_USE', 'Agent tidak dapat dinonaktifkan karena masih memiliki task yang sedang berjalan.');
    }
    if ((usage?.queued ?? 0) > 0) {
      throw new AppError(422, 'AGENT_IN_USE', 'Agent tidak dapat dinonaktifkan karena masih memiliki task dalam antrean.');
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) add('name', input.name);
  if (input.endpoint_url !== undefined) add('endpoint_url', input.endpoint_url);
  if (input.provider_id !== undefined) add('provider_id', input.provider_id);
  if (input.max_concurrency !== undefined) add('max_concurrency', input.max_concurrency);
  if (input.is_active !== undefined) add('is_active', input.is_active);

  values.push(id);
  await query(`UPDATE agents SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
  await recomputeAgentStatus(id);
  const agent = await getAgent(id);
  if (!agent) throw notFound('Agent tidak ditemukan.');
  return agent;
}

export async function rotateAgentToken(id: number): Promise<string> {
  const existing = await getAgent(id);
  if (!existing) throw notFound('Agent tidak ditemukan.');
  const token = `orca_agt_${randomToken(32)}`;
  await query(
    'UPDATE agents SET auth_token_hash = $1, auth_token_encrypted = $2, updated_at = now() WHERE id = $3',
    [sha256(token), encryptSecret(token), id]
  );
  return token;
}

type QueryExecutor = Pick<PoolClient, 'query'>;

/**
 * Satu-satunya penulis agents.status. Sumber kebenaran:
 * - last_error != null  -> OFFLINE
 * - active_tasks_count >= max_concurrency -> BUSY
 * - selain itu -> IDLE
 */
export async function recomputeAgentStatus(agentId: number, client?: QueryExecutor): Promise<AgentStatus | null> {
  const sql = `
    UPDATE agents a
    SET active_tasks_count = c.cnt,
        status = CASE
          WHEN NOT a.is_active THEN 'OFFLINE'
          WHEN a.last_error IS NOT NULL THEN 'OFFLINE'
          WHEN c.cnt >= a.max_concurrency THEN 'BUSY'
          ELSE 'IDLE'
        END,
        updated_at = now()
    FROM (SELECT count(*)::int AS cnt FROM tasks WHERE agent_id = $1 AND status = 'RUNNING') c
    WHERE a.id = $1
    RETURNING a.status`;
  const result = client ? await client.query<{ status: AgentStatus }>(sql, [agentId]) : await pool.query<{ status: AgentStatus }>(sql, [agentId]);
  return result.rows[0]?.status ?? null;
}

export async function findAgentByToken(token: string): Promise<{ id: number; code: string } | null> {
  const row = await queryOne<{ id: number; code: string }>(
    'SELECT id, code FROM agents WHERE auth_token_hash = $1',
    [sha256(token)]
  );
  return row;
}

export async function getAgentDispatchConfig(id: number): Promise<{
  id: number;
  code: string;
  endpointUrl: string;
  providerId: number;
  token: string;
} | null> {
  const row = await queryOne<{
    id: number;
    code: string;
    endpoint_url: string;
    provider_id: number;
    auth_token_encrypted: string;
  }>('SELECT id, code, endpoint_url, provider_id, auth_token_encrypted FROM agents WHERE id = $1', [id]);
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    endpointUrl: row.endpoint_url,
    providerId: row.provider_id,
    token: decryptSecret(row.auth_token_encrypted)
  };
}
