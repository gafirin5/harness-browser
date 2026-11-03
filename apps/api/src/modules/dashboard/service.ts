import type { DashboardSummary } from '@orca/shared';
import { query, queryOne } from '../../db/pool.js';
import { config } from '../../config.js';
import { toIso } from '../../lib/format.js';

interface SummaryRow {
  agents_active: number;
  tasks_running: number;
  tasks_failed_today: number;
  cost_today: string;
}

interface AlertRow {
  type: 'AGENT_OFFLINE' | 'TASK_FAILED';
  id: number;
  label: string;
  since: Date;
}

interface RecentLogRow {
  id: number;
  task_id: number;
  task_code: string;
  log_level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  created_at: Date;
}

const dayStart = `date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1`;
const dayEnd = `(date_trunc('day', now() AT TIME ZONE $1) + interval '1 day') AT TIME ZONE $1`;

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const summary = await queryOne<SummaryRow>(
    `SELECT
       (SELECT count(*) FROM agents WHERE is_active AND status IN ('IDLE','BUSY'))::int AS agents_active,
       (SELECT count(*) FROM tasks WHERE status = 'RUNNING')::int AS tasks_running,
       (SELECT count(*) FROM tasks
          WHERE status = 'FAILED' AND finished_at >= ${dayStart} AND finished_at < ${dayEnd})::int AS tasks_failed_today,
       (SELECT COALESCE(sum(cost_usd), 0)::numeric(12,4)::text FROM tasks
          WHERE status = 'COMPLETED' AND finished_at >= ${dayStart} AND finished_at < ${dayEnd}) AS cost_today`,
    [config.appTimezone]
  );

  const alerts = await query<AlertRow>(
    `SELECT * FROM (
       SELECT 'AGENT_OFFLINE'::text AS type, id, code AS label,
              COALESCE(last_heartbeat_at, updated_at) AS since
       FROM agents
       WHERE is_active AND status = 'OFFLINE'
       UNION ALL
       SELECT 'TASK_FAILED'::text AS type, id, code AS label, finished_at AS since
       FROM tasks
       WHERE status = 'FAILED' AND finished_at >= ${dayStart} AND finished_at < ${dayEnd}
     ) alert
     ORDER BY since ASC
     LIMIT 20`,
    [config.appTimezone]
  );

  const logs = await query<RecentLogRow>(
    `SELECT l.id, l.task_id, t.code AS task_code, l.log_level, l.message, l.created_at
     FROM task_logs l
     JOIN tasks t ON t.id = l.task_id
     ORDER BY l.id DESC
     LIMIT 10`
  );

  return {
    agentsActive: summary?.agents_active ?? 0,
    tasksRunning: summary?.tasks_running ?? 0,
    tasksFailedToday: summary?.tasks_failed_today ?? 0,
    costTodayUsd: summary?.cost_today ?? '0.0000',
    alerts: alerts.map((row) => ({
      type: row.type,
      id: row.id,
      label: row.label,
      since: toIso(row.since) ?? new Date().toISOString()
    })),
    recentLogs: logs.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      taskCode: row.task_code,
      logLevel: row.log_level,
      message: row.message,
      createdAt: toIso(row.created_at) ?? new Date().toISOString()
    }))
  };
}
