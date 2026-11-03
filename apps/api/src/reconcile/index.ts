import { config } from '../config.js';
import { pool, query, withTransaction } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { cleanupSessions } from '../auth/session.js';
import { markStaleAgentsOffline } from '../heartbeat/index.js';
import { recomputeAgentStatus } from '../modules/agents/service.js';
import { broadcastTask, scheduleSummaryBroadcast } from '../realtime/hub.js';

async function recomputeAllAgents(): Promise<number> {
  const result = await pool.query(
    `UPDATE agents a
     SET active_tasks_count = c.cnt,
         status = CASE
           WHEN NOT a.is_active THEN 'OFFLINE'
           WHEN a.last_error IS NOT NULL THEN 'OFFLINE'
           WHEN c.cnt >= a.max_concurrency THEN 'BUSY'
           ELSE 'IDLE'
         END,
         updated_at = now()
     FROM (
       SELECT a2.id, count(t.id)::int AS cnt
       FROM agents a2
       LEFT JOIN tasks t ON t.agent_id = a2.id AND t.status = 'RUNNING'
       GROUP BY a2.id
     ) c
     WHERE a.id = c.id
       AND (
         a.active_tasks_count <> c.cnt
         OR a.status <> CASE
              WHEN NOT a.is_active THEN 'OFFLINE'
              WHEN a.last_error IS NOT NULL THEN 'OFFLINE'
              WHEN c.cnt >= a.max_concurrency THEN 'BUSY'
              ELSE 'IDLE'
            END
       )
     RETURNING a.id`
  );
  return result.rowCount ?? 0;
}

interface StaleTask {
  id: number;
  code: string;
  agent_id: number;
}

async function failStaleTasks(): Promise<number> {
  const tasks = await query<StaleTask>(
    `SELECT id, code, agent_id FROM tasks
     WHERE status = 'RUNNING'
       AND started_at IS NOT NULL
       AND started_at < now() - ($1::int * interval '1 millisecond')`,
    [config.taskMaxDurationMs]
  );

  for (const task of tasks) {
    await withTransaction(async (client) => {
      const selected = await client.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1 FOR UPDATE', [task.id]);
      if (selected.rows[0]?.status !== 'RUNNING') return;
      await client.query(
        `UPDATE tasks
         SET status = 'FAILED', error_message = 'Melewati batas waktu eksekusi.', finished_at = now(), updated_at = now()
         WHERE id = $1`,
        [task.id]
      );
      await client.query(
        `INSERT INTO task_logs (task_id, user_id, actor_type, from_status, to_status, log_level, message)
         VALUES ($1, NULL, 'SYSTEM', 'RUNNING', 'FAILED', 'ERROR', 'Task melewati batas waktu eksekusi dan ditandai FAILED.')`,
        [task.id]
      );
      await recomputeAgentStatus(task.agent_id, client);
    });
    broadcastTask({ id: task.id, code: task.code, status: 'FAILED' });
  }

  return tasks.length;
}

export async function reconcileOnce(): Promise<void> {
  // Dijalankan berurutan agar perubahan status agent tidak saling menimpa.
  const staleAgents = await markStaleAgentsOffline();
  const agentsFixed = await recomputeAllAgents();
  const staleTasks = await failStaleTasks();
  const sessions = await cleanupSessions();
  if (staleAgents || staleTasks || agentsFixed || sessions) {
    scheduleSummaryBroadcast();
  }
}

let timer: NodeJS.Timeout | null = null;

export function startReconcile(): void {
  timer = setInterval(() => {
    reconcileOnce().catch((error) => logger.error({ err: error }, 'Rekonsiliasi error'));
  }, 60_000);
  timer.unref();
  setTimeout(() => {
    reconcileOnce().catch((error) => logger.error({ err: error }, 'Rekonsiliasi error'));
  }, 5000).unref();
}

export function stopReconcile(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
