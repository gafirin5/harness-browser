import { db, newId, nowIso } from '../../db/index.js';
import { config } from '../../config.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { buildAgentArgs, getAgent } from '../sessions/agents.js';
import { terminalManager } from '../terminals/manager.js';

export interface AutomationRow {
  id: string;
  project_id: string;
  worktree_id: string | null;
  name: string;
  schedule: string;
  prompt: string;
  agent: string;
  enabled: number;
  retry_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

const PRESETS: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '6h': 360,
  '24h': 1440
};

export function isScheduleValid(schedule: string): boolean {
  const value = schedule.trim().toLowerCase();
  if (value === 'manual' || PRESETS[value] !== undefined) return true;
  const everyMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(value);
  if (everyMinutes && Number(everyMinutes[1]) > 0) return true;
  const everyHours = /^0 \*\/(\d+) \* \* \*$/.exec(value);
  if (everyHours && Number(everyHours[1]) > 0) return true;
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(value)) return true;
  return false;
}

function timezoneParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(date);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second')
  };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = timezoneParts(new Date(guess), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess + (guess - asUtc));
}

function nextDaily(hour: number, minute: number, timeZone: string | undefined, from: Date): Date {
  if (!timeZone) {
    const next = new Date(from);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  try {
    const parts = timezoneParts(from, timeZone);
    let candidate = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timeZone);
    if (candidate.getTime() <= from.getTime()) {
      candidate = zonedTimeToUtc(parts.year, parts.month, parts.day + 1, hour, minute, timeZone);
    }
    return candidate;
  } catch {
    const next = new Date(from);
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
}

export function computeNextRun(schedule: string, from = new Date(), timeZone?: string): Date | null {
  const value = schedule.trim().toLowerCase();
  if (value === 'manual') return null;

  const presetMinutes = PRESETS[value];
  if (presetMinutes !== undefined) return new Date(from.getTime() + presetMinutes * 60_000);

  const everyMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(value);
  if (everyMinutes) {
    const minutes = Math.max(1, Number(everyMinutes[1]));
    return new Date(from.getTime() + minutes * 60_000);
  }

  const everyHours = /^0 \*\/(\d+) \* \* \*$/.exec(value);
  if (everyHours) {
    const hours = Math.max(1, Number(everyHours[1]));
    return new Date(from.getTime() + hours * 3_600_000);
  }

  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(value);
  if (daily) {
    return nextDaily(Number(daily[2]), Number(daily[1]), timeZone ?? config.appTimezone, from);
  }

  return null;
}

function updateRunStatuses(): void {
  db.prepare(
    `UPDATE automation_runs
     SET status = (SELECT s.status FROM sessions s WHERE s.id = automation_runs.session_id),
         finished_at = (SELECT s.ended_at FROM sessions s WHERE s.id = automation_runs.session_id)
     WHERE session_id IS NOT NULL
       AND status = 'running'
       AND EXISTS (
         SELECT 1 FROM sessions s WHERE s.id = automation_runs.session_id AND s.status != 'running'
       )`
  ).run();
}

function failRun(row: AutomationRow, message: string, allowRetry = true): void {
  const now = nowIso();
  db.prepare(
    'INSERT INTO automation_runs (id, automation_id, session_id, status, error, started_at, finished_at) VALUES (?, ?, NULL, ?, ?, ?, ?)'
  ).run(newId(), row.id, 'failed', message, now, now);
  const retryCount = row.retry_count ?? 0;
  const willRetry = allowRetry && row.schedule.toLowerCase() !== 'manual' && retryCount < 2;
  const next = willRetry
    ? new Date(Date.now() + 5 * 60_000)
    : computeNextRun(row.schedule, new Date(), config.appTimezone);
  db.prepare('UPDATE automations SET last_run_at = ?, next_run_at = ?, retry_count = ? WHERE id = ?').run(
    now,
    next ? next.toISOString() : null,
    willRetry ? retryCount + 1 : 0,
    row.id
  );
}

export interface RunResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

export async function runAutomation(id: string, options: { manual?: boolean } = {}): Promise<RunResult> {
  const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as unknown as AutomationRow | undefined;
  if (!row) return { ok: false, error: 'Otomasi tidak ditemukan.' };

  const worktree = row.worktree_id
    ? getWorktreeRow(row.worktree_id)
    : ((db
        .prepare('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at ASC LIMIT 1')
        .get(row.project_id) as unknown as ReturnType<typeof getWorktreeRow>) ?? null);
  if (!worktree) {
    failRun(row, 'Worktree tidak ditemukan.', !options.manual);
    return { ok: false, error: 'Worktree tidak ditemukan.' };
  }

  const agent = getAgent(row.agent);
  if (!agent) {
    failRun(row, 'Agent tidak dikenal.', !options.manual);
    return { ok: false, error: 'Agent tidak dikenal.' };
  }
  if (!agent.installed) {
    failRun(row, `Agent ${agent.name} belum terpasang di host ini.`, !options.manual);
    return { ok: false, error: `Agent ${agent.name} belum terpasang.` };
  }

  const createdAt = nowIso();
  try {
    const terminal = terminalManager.create({
      worktreeId: worktree.id,
      title: `Auto: ${row.name}`.slice(0, 80),
      kind: 'agent',
      command: agent.command,
      args: buildAgentArgs(agent.args, row.prompt),
      cols: 120,
      rows: 34
    });

    const sessionId = newId();
    db.prepare(
      `INSERT INTO sessions (id, worktree_id, terminal_id, agent, title, prompt, status, created_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`
    ).run(
      sessionId,
      worktree.id,
      terminal.id,
      agent.id,
      `Auto: ${row.name}`.slice(0, 120),
      row.prompt,
      createdAt,
      createdAt
    );

    db.prepare(
      'INSERT INTO automation_runs (id, automation_id, session_id, status, error, started_at) VALUES (?, ?, ?, ?, NULL, ?)'
    ).run(newId(), row.id, sessionId, 'running', createdAt);

    const next = options.manual
      ? row.next_run_at
      : (computeNextRun(row.schedule, new Date(), config.appTimezone)?.toISOString() ?? null);
    db.prepare('UPDATE automations SET last_run_at = ?, next_run_at = ?, retry_count = 0 WHERE id = ?').run(
      createdAt,
      next,
      row.id
    );
    return { ok: true, sessionId };
  } catch (error) {
    const message = (error as Error).message || 'Gagal menjalankan otomasi.';
    failRun(row, message, !options.manual);
    return { ok: false, error: message };
  }
}

let ticking = false;

export async function tickAutomations(): Promise<number> {
  if (ticking) return 0;
  ticking = true;
  try {
    updateRunStatuses();
    const now = nowIso();
    const due = db
      .prepare(
        "SELECT * FROM automations WHERE enabled = 1 AND schedule != 'manual' AND (next_run_at IS NULL OR next_run_at <= ?)"
      )
      .all(now) as unknown as AutomationRow[];
    for (const row of due) {
      await runAutomation(row.id);
    }
    return due.length;
  } finally {
    ticking = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startAutomations(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickAutomations().catch((error) => {
      console.error('[dorado] automation tick gagal:', (error as Error).message);
    });
  }, 30_000);
  timer.unref?.();
}

export function stopAutomations(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
