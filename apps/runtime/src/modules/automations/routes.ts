import { Router } from 'express';
import { z } from 'zod';
import { automationCreateSchema, automationUpdateSchema, type Automation, type AutomationRun } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getProject } from '../projects/routes.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { computeNextRun, isScheduleValid, runAutomation, type AutomationRow } from './service.js';

function mapAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    projectId: row.project_id,
    worktreeId: row.worktree_id,
    name: row.name,
    schedule: row.schedule,
    prompt: row.prompt,
    agent: row.agent,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at
  };
}

const listQuery = z.object({ projectId: z.string().min(1).optional() });
const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

function assertSchedule(schedule: string): void {
  if (!isScheduleValid(schedule)) {
    throw new AppError(
      422,
      'INVALID_SCHEDULE',
      'Jadwal tidak valid. Gunakan manual, 5m/15m/30m/1h/6h/24h, atau cron sederhana.'
    );
  }
}

function assertWorktree(projectId: string, worktreeId: string | null | undefined): void {
  if (!worktreeId) return;
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree || worktree.project_id !== projectId) {
    throw new AppError(422, 'INVALID_WORKTREE', 'Worktree tidak berada di project ini.');
  }
}

export const automationsRouter = Router();
automationsRouter.use(csrfGuard, requireAuth);

automationsRouter.get('/', (req, res) => {
  const query = parseWith(listQuery, req.query);
  const rows = (query.projectId
    ? db.prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC').all(query.projectId)
    : db.prepare('SELECT * FROM automations ORDER BY created_at DESC').all()) as unknown as AutomationRow[];
  res.json({ data: rows.map(mapAutomation) });
});

automationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(automationCreateSchema, req.body);
    const project = getProject(body.projectId);
    if (!project) throw notFound('Project tidak ditemukan.');
    assertSchedule(body.schedule);
    assertWorktree(body.projectId, body.worktreeId);

    const id = newId();
    const createdAt = nowIso();
    const next = body.enabled ? computeNextRun(body.schedule, new Date(), config.appTimezone) : null;
    db.prepare(
      `INSERT INTO automations
       (id, project_id, worktree_id, name, schedule, prompt, agent, enabled, last_run_at, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      id,
      body.projectId,
      body.worktreeId ?? null,
      body.name,
      body.schedule,
      body.prompt,
      body.agent,
      body.enabled ? 1 : 0,
      next ? next.toISOString() : null,
      createdAt
    );
    const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as unknown as AutomationRow;
    res.status(201).json({ data: mapAutomation(row) });
  })
);

automationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as unknown as AutomationRow | undefined;
    if (!row) throw notFound('Otomasi tidak ditemukan.');
    const body = parseWith(automationUpdateSchema, req.body);
    if (body.schedule) assertSchedule(body.schedule);
    const worktreeId = body.worktreeId === undefined ? row.worktree_id : body.worktreeId;
    assertWorktree(row.project_id, worktreeId);

    const schedule = body.schedule ?? row.schedule;
    const enabled = body.enabled === undefined ? row.enabled === 1 : body.enabled;
    let nextRunAt = row.next_run_at;
    if (!enabled || schedule.trim().toLowerCase() === 'manual') {
      nextRunAt = null;
    } else if (body.schedule !== undefined || !nextRunAt) {
      nextRunAt = computeNextRun(schedule, new Date(), config.appTimezone)?.toISOString() ?? null;
    }

    db.prepare(
      `UPDATE automations SET name = ?, schedule = ?, prompt = ?, agent = ?, worktree_id = ?, enabled = ?, next_run_at = ?
       WHERE id = ?`
    ).run(
      body.name ?? row.name,
      schedule,
      body.prompt ?? row.prompt,
      body.agent ?? row.agent,
      worktreeId,
      enabled ? 1 : 0,
      nextRunAt,
      id
    );
    const updated = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as unknown as AutomationRow;
    res.json({ data: mapAutomation(updated) });
  })
);

automationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const row = db.prepare('SELECT id FROM automations WHERE id = ?').get(id);
    if (!row) throw notFound('Otomasi tidak ditemukan.');
    db.prepare('DELETE FROM automations WHERE id = ?').run(id);
    res.status(204).end();
  })
);

automationsRouter.post(
  '/:id/run',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const row = db.prepare('SELECT id FROM automations WHERE id = ?').get(id);
    if (!row) throw notFound('Otomasi tidak ditemukan.');
    const result = await runAutomation(id, { manual: true });
    if (!result.ok) throw new AppError(422, 'AUTOMATION_RUN_FAILED', result.error ?? 'Gagal menjalankan otomasi.');
    res.json({ data: { ok: true, sessionId: result.sessionId } });
  })
);

automationsRouter.get(
  '/:id/runs',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const row = db.prepare('SELECT id FROM automations WHERE id = ?').get(id);
    if (!row) throw notFound('Otomasi tidak ditemukan.');
    const query = parseWith(runsQuery, req.query);
    const rows = db
      .prepare(
        `SELECT r.*, COALESCE(s.status, r.status) AS live_status
         FROM automation_runs r
         LEFT JOIN sessions s ON s.id = r.session_id
         WHERE r.automation_id = ?
         ORDER BY r.started_at DESC
         LIMIT ?`
      )
      .all(id, query.limit) as unknown as Array<{
      id: string;
      automation_id: string;
      session_id: string | null;
      status: string;
      live_status: string;
      error: string | null;
      started_at: string;
      finished_at: string | null;
    }>;
    const runs: AutomationRun[] = rows.map((run) => ({
      id: run.id,
      automationId: run.automation_id,
      sessionId: run.session_id,
      status: run.live_status,
      error: run.error,
      startedAt: run.started_at,
      finishedAt: run.finished_at
    }));
    res.json({ data: runs });
  })
);
