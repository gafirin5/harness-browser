import { Router } from 'express';
import { projectCreateSchema, type Project } from '@dorado/shared';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { listBranches, resolveRepo } from '../../lib/git.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  created_at: string;
}

function mapProject(row: ProjectRow): Project {
  return { id: row.id, name: row.name, path: row.path, createdAt: row.created_at };
}

export function listProjects(): Project[] {
  const rows = db.prepare('SELECT id, name, path, created_at FROM projects ORDER BY created_at ASC').all() as unknown as unknown as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT id, name, path, created_at FROM projects WHERE id = ?').get(id) as unknown as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export const projectsRouter = Router();
projectsRouter.use(csrfGuard, requireAuth);

projectsRouter.get('/', (_req, res) => {
  res.json({ data: listProjects() });
});

projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(projectCreateSchema, req.body);
    const repoPath = await resolveRepo(body.path);
    const existing = db.prepare('SELECT id FROM projects WHERE path = ?').get(repoPath) as { id: string } | undefined;
    if (existing) throw new AppError(409, 'CONFLICT', 'Repository ini sudah ditambahkan.');
    const id = newId();
    const createdAt = nowIso();
    db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      body.name,
      repoPath,
      createdAt
    );
    res.status(201).json({ data: { id, name: body.name, path: repoPath, createdAt } });
  })
);

projectsRouter.get(
  '/:id/branches',
  asyncHandler(async (req, res) => {
    const project = getProject(String(req.params.id ?? ''));
    if (!project) throw notFound('Project tidak ditemukan.');
    res.json({ data: await listBranches(project.path) });
  })
);

projectsRouter.delete('/:id', (req, res) => {
  const project = getProject(String(req.params.id ?? ''));
  if (!project) throw notFound('Project tidak ditemukan.');
  const count = db.prepare('SELECT count(*) AS total FROM worktrees WHERE project_id = ?').get(project.id) as {
    total: number;
  };
  if (count.total > 0) throw new AppError(422, 'PROJECT_IN_USE', 'Hapus semua worktree project ini terlebih dahulu.');
  db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  res.status(204).end();
});