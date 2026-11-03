import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// bigserial/int8 dikembalikan sebagai string oleh node-postgres secara default.
// Semua id pada aplikasi ini berada jauh di bawah Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

pool.on('error', (error) => {
  // Logger diimpor secara lazy untuk menghindari siklus config -> logger -> db.
  console.error('PostgreSQL pool error:', error.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
