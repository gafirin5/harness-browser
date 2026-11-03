#!/usr/bin/env node
/**
 * Seed data performa: 10.000 task dan 100.000 task_logs.
 * Pemakaian: node scripts/seed-perf.mjs
 * Data lama berawalan PERF- akan dihapus lebih dulu.
 */
import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgres://orca:orca@127.0.0.1:5432/orca';
const client = new pg.Client({ connectionString });

await client.connect();
try {
  const admin = await client.query('SELECT id FROM users ORDER BY id LIMIT 1');
  if (!admin.rows[0]) throw new Error('Belum ada user. Jalankan npm run seed:admin terlebih dahulu.');
  const userId = admin.rows[0].id;

  await client.query('BEGIN');

  let provider = await client.query('SELECT id FROM providers WHERE name = $1', ['PERF Provider']);
  if (!provider.rows[0]) {
    provider = await client.query(
      `INSERT INTO providers (user_id, name, provider_type, base_url, api_key_encrypted, default_model, cost_per_1k_tokens, is_active)
       VALUES ($1, 'PERF Provider', 'LITELLM', 'http://127.0.0.1:9', 'v1.invalid.invalid.invalid', 'perf-model', 0.0020, false)
       RETURNING id`,
      [userId]
    );
  }
  const providerId = provider.rows[0].id;

  let agent = await client.query('SELECT id FROM agents WHERE code = $1', ['PERF-AGT']);
  if (!agent.rows[0]) {
    agent = await client.query(
      `INSERT INTO agents (user_id, provider_id, code, name, endpoint_url, status, max_concurrency,
                           active_tasks_count, auth_token_hash, auth_token_encrypted, is_active)
       VALUES ($1, $2, 'PERF-AGT', 'Perf Agent', 'http://127.0.0.1:9', 'OFFLINE', 10, 0,
               'perf', 'v1.invalid.invalid.invalid', false)
       RETURNING id`,
      [userId, providerId]
    );
  }
  const agentId = agent.rows[0].id;

  await client.query(
    `DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE code LIKE 'PERF-%')`
  );
  await client.query(`DELETE FROM tasks WHERE code LIKE 'PERF-%'`);

  await client.query(
    `INSERT INTO tasks (code, user_id, agent_id, provider_id, title, prompt, priority, status,
                        token_used, cost_per_1k_snapshot, cost_usd, cancel_reason,
                        started_at, finished_at, created_at, updated_at)
     SELECT
       'PERF-' || lpad(i::text, 6, '0'),
       $1, $2, $3,
       'Perf task ' || i,
       'Prompt pengujian performa nomor ' || i,
       (i % 3) + 1,
       CASE WHEN i % 5 = 0 THEN 'FAILED' WHEN i % 7 = 0 THEN 'CANCELLED' ELSE 'COMPLETED' END,
       2500, 0.0020, 0.0050,
       CASE WHEN i % 7 = 0 THEN 'Perf cancel' ELSE NULL END,
       now() - ((i % 30) || ' days')::interval - ((i % 1440) || ' minutes')::interval,
       now() - ((i % 30) || ' days')::interval - ((i % 1440) || ' minutes')::interval + interval '2 minutes',
       now() - ((i % 30) || ' days')::interval - ((i % 1440) || ' minutes')::interval,
       now()
     FROM generate_series(1, 10000) AS i`,
    [userId, agentId, providerId]
  );

  await client.query(
    `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message, created_at)
     SELECT t.id, NULL, 'SYSTEM', NULL, 'QUEUED', 'INFO', 'Log performa ' || g, t.created_at + (g || ' seconds')::interval
     FROM tasks t
     CROSS JOIN generate_series(1, 10) AS g
     WHERE t.code LIKE 'PERF-%'`
  );

  await client.query('ANALYZE tasks');
  await client.query('ANALYZE task_logs');
  await client.query('COMMIT');

  const counts = await client.query(
    `SELECT
       (SELECT count(*) FROM tasks WHERE code LIKE 'PERF-%')::int AS tasks,
       (SELECT count(*) FROM task_logs l JOIN tasks t ON t.id = l.task_id WHERE t.code LIKE 'PERF-%')::int AS logs`
  );
  console.log(`[seed-perf] selesai: ${counts.rows[0].tasks} task, ${counts.rows[0].logs} log.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('[seed-perf] gagal:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
