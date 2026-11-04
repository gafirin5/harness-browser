import type { OrchDashboardSummary, OrchLogLevel } from '@dorado/shared';
import { sumDecimal4 } from '@dorado/shared';
import { config } from '../../config.js';
import { db } from '../../db/index.js';

function partsFor(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return map;
}

function offsetMsAt(date: Date, timeZone: string): number {
  const parts = partsFor(date, timeZone);
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

export function zonedDayStartIso(ymd: string, timeZone = config.appTimezone): string {
  let guess = new Date(`${ymd}T12:00:00Z`);
  let offset = offsetMsAt(guess, timeZone);
  guess = new Date(guess.getTime() - offset);
  offset = offsetMsAt(guess, timeZone);
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - offset).toISOString();
}

function nextYmd(ymd: string): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function zonedDayEndIso(ymd: string, timeZone = config.appTimezone): string {
  return zonedDayStartIso(nextYmd(ymd), timeZone);
}

export function todayYmd(timeZone = config.appTimezone): string {
  const parts = partsFor(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function todayRange(): { start: string; end: string } {
  const today = todayYmd();
  return { start: zonedDayStartIso(today), end: zonedDayEndIso(today) };
}

export function businessDateInfo(timeZone = config.appTimezone): { ymd: string; businessDate: string } {
  const parts = partsFor(new Date(), timeZone);
  return {
    ymd: `${parts.year}${parts.month}${parts.day}`,
    businessDate: `${parts.year}-${parts.month}-${parts.day}`
  };
}

interface AlertRow {
  type: 'AGENT_OFFLINE' | 'TASK_FAILED';
  id: number;
  label: string;
  since: string;
}

export function getDashboardSummary(): OrchDashboardSummary {
  const { start, end } = todayRange();
  const agentsActive = (
    db.prepare("SELECT count(*) AS total FROM agents WHERE is_active = 1 AND status IN ('IDLE','BUSY')").get() as {
      total: number;
    }
  ).total;
  const tasksRunning = (
    db.prepare("SELECT count(*) AS total FROM tasks WHERE status = 'RUNNING'").get() as { total: number }
  ).total;
  const tasksFailedToday = (
    db
      .prepare("SELECT count(*) AS total FROM tasks WHERE status = 'FAILED' AND finished_at >= ? AND finished_at < ?")
      .get(start, end) as { total: number }
  ).total;
  const costRows = db
    .prepare("SELECT cost_usd FROM tasks WHERE status = 'COMPLETED' AND finished_at >= ? AND finished_at < ?")
    .all(start, end) as Array<{ cost_usd: string }>;
  const costTodayUsd = sumDecimal4(costRows.map((row) => row.cost_usd));

  const alerts = db
    .prepare(
      `SELECT * FROM (
         SELECT 'AGENT_OFFLINE' AS type, id, code AS label,
                COALESCE(last_heartbeat_at, updated_at) AS since
         FROM agents
         WHERE is_active = 1 AND status = 'OFFLINE'
         UNION ALL
         SELECT 'TASK_FAILED' AS type, id, code AS label, finished_at AS since
         FROM tasks
         WHERE status = 'FAILED' AND finished_at >= ? AND finished_at < ?
       ) alert
       ORDER BY since ASC
       LIMIT 20`
    )
    .all(start, end) as unknown as AlertRow[];

  const logs = db
    .prepare(
      `SELECT l.id, l.task_id, t.code AS task_code, l.log_level, l.message, l.created_at
       FROM task_logs l
       JOIN tasks t ON t.id = l.task_id
       ORDER BY l.id DESC
       LIMIT 10`
    )
    .all() as Array<{
    id: number;
    task_id: number;
    task_code: string;
    log_level: OrchLogLevel;
    message: string;
    created_at: string;
  }>;

  return {
    agentsActive,
    tasksRunning,
    tasksFailedToday,
    costTodayUsd,
    alerts: alerts.map((row) => ({
      type: row.type,
      id: row.id,
      label: row.label,
      since: row.since
    })),
    recentLogs: logs.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      taskCode: row.task_code,
      logLevel: row.log_level,
      message: row.message,
      createdAt: row.created_at
    }))
  };
}
