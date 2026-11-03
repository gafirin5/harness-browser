import type { Provider, ProviderType } from '@orca/shared';
import { query, queryOne } from '../../db/pool.js';
import { decryptSecret, encryptSecret, apiKeyLast4 } from '../../lib/crypto.js';
import { AppError, notFound } from '../../lib/errors.js';
import { toIso } from '../../lib/format.js';

interface ProviderRow {
  id: number;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key_encrypted: string;
  default_model: string;
  cost_per_1k_tokens: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ProviderCreateInput {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key: string;
  default_model: string;
  cost_per_1k_tokens: string;
}

export interface ProviderUpdateInput {
  name?: string;
  provider_type?: ProviderType;
  base_url?: string;
  api_key?: string;
  default_model?: string;
  cost_per_1k_tokens?: string;
  is_active?: boolean;
}

function last4(row: ProviderRow): string | null {
  try {
    return apiKeyLast4(decryptSecret(row.api_key_encrypted));
  } catch {
    return null;
  }
}

function mapProvider(row: ProviderRow): Provider {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    costPer1kTokens: row.cost_per_1k_tokens,
    isActive: row.is_active,
    hasApiKey: true,
    apiKeyLast4: last4(row),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

const columns = `id, name, provider_type, base_url, api_key_encrypted, default_model, cost_per_1k_tokens, is_active, created_at, updated_at`;

export async function listProviders(q: string, page: number, pageSize: number): Promise<{ data: Provider[]; total: number }> {
  const pattern = `%${q.toLowerCase()}%`;
  const filter = q ? `WHERE lower(name) LIKE $1` : '';
  const params: unknown[] = q ? [pattern] : [];

  const countRow = await queryOne<{ total: string }>(
    `SELECT count(*)::text AS total FROM providers ${filter}`,
    params
  );

  const rows = await query<ProviderRow>(
    `SELECT ${columns} FROM providers ${filter}
     ORDER BY is_active DESC, lower(name) ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return { data: rows.map(mapProvider), total: Number(countRow?.total ?? 0) };
}

export async function getProvider(id: number): Promise<Provider | null> {
  const row = await queryOne<ProviderRow>(`SELECT ${columns} FROM providers WHERE id = $1`, [id]);
  return row ? mapProvider(row) : null;
}

export async function createProvider(userId: number, input: ProviderCreateInput): Promise<Provider> {
  const row = await queryOne<ProviderRow>(
    `INSERT INTO providers (user_id, name, provider_type, base_url, api_key_encrypted, default_model, cost_per_1k_tokens)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${columns}`,
    [
      userId,
      input.name,
      input.provider_type,
      input.base_url,
      encryptSecret(input.api_key),
      input.default_model,
      input.cost_per_1k_tokens
    ]
  );
  if (!row) throw new AppError(500, 'INTERNAL', 'Gagal menyimpan provider.');
  return mapProvider(row);
}

export async function updateProvider(id: number, input: ProviderUpdateInput): Promise<Provider> {
  const existing = await queryOne<ProviderRow>(`SELECT ${columns} FROM providers WHERE id = $1`, [id]);
  if (!existing) throw notFound('Provider tidak ditemukan.');

  if (input.is_active === false) {
    const usage = await queryOne<{ has_tasks: boolean; has_agents: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM tasks WHERE provider_id = $1 AND status IN ('QUEUED','RUNNING')) AS has_tasks,
         EXISTS (SELECT 1 FROM agents WHERE provider_id = $1 AND is_active) AS has_agents`,
      [id]
    );
    if (usage?.has_tasks) {
      throw new AppError(422, 'PROVIDER_IN_USE', 'Provider tidak dapat dinonaktifkan karena masih memiliki task yang aktif.');
    }
    if (usage?.has_agents) {
      throw new AppError(422, 'PROVIDER_IN_USE', 'Provider tidak dapat dinonaktifkan karena masih menjadi provider default agent aktif.');
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (input.name !== undefined) add('name', input.name);
  if (input.provider_type !== undefined) add('provider_type', input.provider_type);
  if (input.base_url !== undefined) add('base_url', input.base_url);
  if (input.api_key !== undefined) add('api_key_encrypted', encryptSecret(input.api_key));
  if (input.default_model !== undefined) add('default_model', input.default_model);
  if (input.cost_per_1k_tokens !== undefined) add('cost_per_1k_tokens', input.cost_per_1k_tokens);
  if (input.is_active !== undefined) add('is_active', input.is_active);

  values.push(id);
  const row = await queryOne<ProviderRow>(
    `UPDATE providers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING ${columns}`,
    values
  );
  if (!row) throw notFound('Provider tidak ditemukan.');
  return mapProvider(row);
}

export async function getProviderCredentials(id: number): Promise<{
  id: number;
  providerType: ProviderType;
  baseUrl: string;
  defaultModel: string;
  costPer1kTokens: string;
  apiKey: string | null;
} | null> {
  const row = await queryOne<ProviderRow>(`SELECT ${columns} FROM providers WHERE id = $1`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    providerType: row.provider_type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    costPer1kTokens: row.cost_per_1k_tokens,
    apiKey: decryptSecret(row.api_key_encrypted)
  };
}
