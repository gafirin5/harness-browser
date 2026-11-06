import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { worktreeCreateSchema, worktreeUpdateSchema, type Worktree } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { createWorktree, git, isWorktreeHealthy, removeWorktree, slugifyBranch } from '../../lib/git.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getProject } from '../projects/routes.js';
import { getNodeTarget } from '../nodes/dispatch.js';

interface WorktreeRow {
  id: string;
  project_id: string;
  branch: string;
  path: string;
  base_ref: string;
  status: string;
  task_status: string;
  note: string;
  created_at: string;
}

const TASK_STATUSES = ['todo', 'in-progress', 'in-review', 'completed'] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

function normalizeTaskStatus(value: string): TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : 'todo';
}

async function mapWorktree(row: WorktreeRow): Promise<Worktree> {
  const healthy = await isWorktreeHealthy(row.path);
  return {
    id: row.id,
    projectId: row.project_id,
    branch: row.branch,
    path: row.path,
    baseRef: row.base_ref,
    status: healthy ? 'ready' : 'missing',
    taskStatus: normalizeTaskStatus(row.task_status),
    note: row.note ?? '',
    createdAt: row.created_at
  };
}

export function getWorktreeRow(id: string): WorktreeRow | null {
  return (db.prepare('SELECT * FROM worktrees WHERE id = ?').get(id) as unknown as WorktreeRow | undefined) ?? null;
}

export const worktreesRouter = Router();
worktreesRouter.use(csrfGuard, requireAuth);

worktreesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('worktrees.list', { projectId: req.query.projectId });
      res.json({ data });
      return;
    }
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    const rows = (projectId
      ? db.prepare('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at ASC').all(projectId)
      : db.prepare('SELECT * FROM worktrees ORDER BY created_at ASC').all()) as unknown as unknown as WorktreeRow[];
    res.json({ data: await Promise.all(rows.map(mapWorktree)) });
  })
);

worktreesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('worktrees.create', req.body);
      res.status(201).json({ data });
      return;
    }
    const body = parseWith(worktreeCreateSchema, req.body);
    const project = getProject(body.projectId);
    if (!project) throw notFound('Project tidak ditemukan.');

    await git(project.path, ['rev-parse', '--verify', body.baseRef]);

    const id = newId();
    const branch = body.branch;
    const directory = path.join(config.worktreesDir, project.id, `${slugifyBranch(branch)}-${id.slice(0, 6)}`);
    const relative = path.relative(config.worktreesDir, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(422, 'INVALID_PATH', 'Path worktree tidak valid.');
    }

    try {
      await createWorktree(project.path, directory, branch, body.baseRef);
    } catch (error) {
      throw new AppError(422, 'GIT_ERROR', (error as Error).message);
    }

    const createdAt = nowIso();
    db.prepare(
      'INSERT INTO worktrees (id, project_id, branch, path, base_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, branch, directory, body.baseRef, 'ready', createdAt);

    res.status(201).json({
      data: {
        id,
        projectId: project.id,
        branch,
        path: directory,
        baseRef: body.baseRef,
        status: 'ready',
        taskStatus: 'todo',
        note: '',
        createdAt
      }
    });
  })
);

worktreesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('worktrees.update', { id: req.params.id, ...req.body });
      res.json({ data });
      return;
    }
    const row = getWorktreeRow(String(req.params.id ?? ''));
    if (!row) throw notFound('Worktree tidak ditemukan.');
    const body = parseWith(worktreeUpdateSchema, req.body);
    db.prepare('UPDATE worktrees SET task_status = ?, note = ? WHERE id = ?').run(
      body.taskStatus ?? row.task_status,
      body.note ?? row.note,
      row.id
    );
    const updated = getWorktreeRow(row.id);
    if (!updated) throw notFound('Worktree tidak ditemukan.');
    res.json({ data: await mapWorktree(updated) });
  })
);

worktreesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      await remote.call('worktrees.delete', { id: req.params.id, force: req.query.force === '1' });
      res.status(204).end();
      return;
    }
    const row = getWorktreeRow(String(req.params.id ?? ''));
    if (!row) throw notFound('Worktree tidak ditemukan.');
    const project = getProject(row.project_id);
    if (!project) throw notFound('Project tidak ditemukan.');

    const runningTerminals = db
      .prepare("SELECT count(*) AS total FROM terminals WHERE worktree_id = ? AND status = 'running'")
      .get(row.id) as { total: number };
    const runningSessions = db
      .prepare("SELECT count(*) AS total FROM sessions WHERE worktree_id = ? AND status = 'running'")
      .get(row.id) as { total: number };
    if (runningTerminals.total > 0 || runningSessions.total > 0) {
      throw new AppError(422, 'WORKTREE_IN_USE', 'Hentikan semua terminal dan sesi sebelum menghapus worktree.');
    }

    const force = req.query.force === '1';
    await removeWorktree(project.path, row.path, force);
    db.prepare('DELETE FROM worktrees WHERE id = ?').run(row.id);
    await fs.rm(row.path, { recursive: true, force: true }).catch(() => undefined);
    res.status(204).end();
  })
);
