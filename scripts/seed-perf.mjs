#!/usr/bin/env node
/**
 * Seed data performa untuk Orchestrator (default 10.000 task + 100.000 log).
 * Jalankan setelah `npm run build:runtime`.
 *
 * Pemakaian:
 *   DATA_DIR=/tmp/dorado-perf node scripts/seed-perf.mjs
 *   DATA_DIR=/tmp/dorado-perf node scripts/seed-perf.mjs --tasks=1000 --logs=10000
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDb = path.join(root, 'apps/runtime/dist/db/index.js');
if (!fs.existsSync(distDb)) {
  console.error('[seed-perf] Build runtime belum ada. Jalankan: npm run build:runtime');
  process.exit(1);
}

const argNumber = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  const parsed = found ? Number(found.split('=')[1]) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const taskCount = argNumber('tasks', Number(process.env.PERF_TASKS ?? 10000));
const logCount = argNumber('logs', Number(process.env.PERF_LOGS ?? 100000));
const logsPerTask = Math.max(1, Math.round(logCount / taskCount));
const now = Date.now();

const { db } = await import(pathToFileURL(distDb).href);

console.log(`[seed-perf] data dir: ${process.env.DATA_DIR ?? './data'}`);
console.log(`[seed-perf] ${taskCount} task, ${logsPerTask} log/task (target ${logCount} log)`);

const started = Date.now();
db.exec('PRAGMA foreign_keys = OFF');
db.exec(
  'DELETE FROM task_logs; DELETE FROM tasks; DELETE FROM agents; DELETE FROM providers; DELETE FROM task_code_sequences;'
);
db.exec('PRAGMA foreign_keys = ON');

const stamp = new Date().toISOString();
const providerRow = db
  .prepare(
    `INSERT INTO providers (name, provider_type, base_url, api_key_encrypted, default_model, cost_per_1k_tokens, is_active, created_at, updated_at)
     VALUES ('Perf Provider', 'LITELLM', 'http://127.0.0.1:9999/v1', 'v1.perf.only', 'gpt-4o-mini', '0.0020', 1, ?, ?)
     RETURNING id`
  )
  .get(stamp, stamp);
const agentRow = db
  .prepare(
    `INSERT INTO agents (provider_id, code, name, endpoint_url, status, max_concurrency, active_tasks_count,
                         auth_token_hash, auth_token_encrypted, is_active, created_at, updated_at)
     VALUES (?, 'AGT-PERF-01', 'Perf Agent', 'http://127.0.0.1:9', 'OFFLINE', 1, 0,
             'perf-token-hash', 'v1.perf.only', 0, ?, ?)
     RETURNING id`
  )
  .get(providerRow.id, stamp, stamp);

const insertTask = db.prepare(
  `INSERT INTO tasks (code, agent_id, provider_id, title, prompt, priority, status, token_used,
                      cost_per_1k_snapshot, cost_usd, error_message, result, started_at, finished_at,
                      created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0.0020', ?, ?, ?, ?, ?, ?, ?)
   RETURNING id`
);
const insertLog = db.prepare(
  `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message, created_at)
   VALUES (?, NULL, 'SYSTEM', ?, ?, ?, ?, ?)`
);

const statuses = [
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'COMPLETED',
  'FAILED',
  'RUNNING',
  'QUEUED'
];
const taskIds = [];

db.exec('BEGIN');
try {
  for (let i = 0; i < taskCount; i += 1) {
    const code = `TSK-PERF-${String(i + 1).padStart(5, '0')}`;
    const status = statuses[i % statuses.length];
    const createdAt = new Date(now - Math.floor((i / taskCount) * 30 * 24 * 60 * 60 * 1000)).toISOString();
    const finishedAt = status === 'COMPLETED' || status === 'FAILED' ? createdAt : null;
    const startedAt = status === 'QUEUED' ? null : createdAt;
    const tokenUsed = status === 'COMPLETED' ? 2500 : 0;
    const cost = status === 'COMPLETED' ? '0.0050' : '0.0000';
    const error = status === 'FAILED' ? 'Seed task gagal untuk pengujian performa.' : null;
    const result = status === 'COMPLETED' ? `Hasil seed ${code}` : null;
    const row = insertTask.get(
      code,
      agentRow.id,
      providerRow.id,
      `Perf task ${i + 1}`,
      `Prompt performa untuk ${code}. Data ini dibuat oleh scripts/seed-perf.mjs.`,
      2,
      status,
      tokenUsed,
      cost,
      error,
      result,
      startedAt,
      finishedAt,
      createdAt,
      createdAt
    );
    taskIds.push(row.id);
  }

  for (let i = 0; i < taskIds.length; i += 1) {
    const taskId = taskIds[i];
    const status = statuses[i % statuses.length];
    for (let j = 0; j < logsPerTask; j += 1) {
      const level = status === 'FAILED' && j === logsPerTask - 1 ? 'ERROR' : 'INFO';
      insertLog.run(
        taskId,
        'QUEUED',
        status,
        level,
        `Log ${j + 1}/${logsPerTask} untuk task ${i + 1}`,
        new Date(now - (i * logsPerTask + j) * 1000).toISOString()
      );
    }
  }
  db.exec('COMMIT');
} catch (error) {
  try {
    db.exec('ROLLBACK');
  } catch {
    // abaikan
  }
  throw error;
}

db.exec('ANALYZE');
const counts = {
  tasks: db.prepare('SELECT count(*) AS total FROM tasks').get().total,
  logs: db.prepare('SELECT count(*) AS total FROM task_logs').get().total
};
db.close();

console.log(`[seed-perf] OK ${counts.tasks} task, ${counts.logs} log dalam ${Date.now() - started} ms.`);
console.log('[seed-perf] Jalankan runtime dengan DATA_DIR yang sama untuk mengukur endpoint.');
