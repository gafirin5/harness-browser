import { Router } from 'express';
import { z } from 'zod';
import { quickCommandCreateSchema, quickCommandUpdateSchema, type QuickCommand } from '@dorado/shared';
import { db, newId, nowIso } from '../../db/index.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getProject } from '../projects/routes.js';

interface QuickCommandRow {
  id: string;
  scope: 'global' | 'project';
  project_id: string | null;
  label: string;
  command: string;
  created_at: string;
}

function mapRow(row: QuickCommandRow): QuickCommand {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    label: row.label,
    command: row.command,
    createdAt: row.created_at
  };
}

const listQuery = z.object({
  projectId: z.string().min(1).optional()
});

export const quickCommandsRouter = Router();
quickCommandsRouter.use(csrfGuard, requireAuth);

quickCommandsRouter.get('/', (req, res) => {
  const query = parseWith(listQuery, req.query);
  const rows = (query.projectId
    ? db
        .prepare(
          `SELECT * FROM quick_commands
             WHERE scope = 'global' OR (scope = 'project' AND project_id = ?)
             ORDER BY created_at DESC`
        )
        .all(query.projectId)
    : db
        .prepare("SELECT * FROM quick_commands WHERE scope = 'global' ORDER BY created_at DESC")
        .all()) as unknown as QuickCommandRow[];
  res.json({ data: rows.map(mapRow) });
});

quickCommandsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = parseWith(quickCommandCreateSchema, req.body);
    const projectId = body.scope === 'project' ? (body.projectId ?? null) : null;
    if (body.scope === 'project') {
      if (!projectId || !getProject(projectId)) throw notFound('Project tidak ditemukan.');
    }

    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      'INSERT INTO quick_commands (id, scope, project_id, label, command, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, body.scope, projectId, body.label, body.command, createdAt);
    res.status(201).json({
      data: mapRow({
        id,
        scope: body.scope,
        project_id: projectId,
        label: body.label,
        command: body.command,
        created_at: createdAt
      })
    });
  })
);

quickCommandsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const existing = db.prepare('SELECT * FROM quick_commands WHERE id = ?').get(id) as unknown as
      | QuickCommandRow
      | undefined;
    if (!existing) throw notFound('Quick command tidak ditemukan.');

    const body = parseWith(quickCommandUpdateSchema, req.body);
    const scope = body.scope ?? existing.scope;
    const projectId = scope === 'project' ? (body.projectId ?? existing.project_id) : null;
    if (scope === 'project') {
      if (!projectId || !getProject(projectId)) throw notFound('Project tidak ditemukan.');
    }

    db.prepare('UPDATE quick_commands SET scope = ?, project_id = ?, label = ?, command = ? WHERE id = ?').run(
      scope,
      projectId,
      body.label ?? existing.label,
      body.command ?? existing.command,
      id
    );
    const updated = db.prepare('SELECT * FROM quick_commands WHERE id = ?').get(id) as unknown as QuickCommandRow;
    res.json({ data: mapRow(updated) });
  })
);

quickCommandsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const existing = db.prepare('SELECT id FROM quick_commands WHERE id = ?').get(id);
    if (!existing) throw notFound('Quick command tidak ditemukan.');
    db.prepare('DELETE FROM quick_commands WHERE id = ?').run(id);
    res.status(204).end();
  })
);
