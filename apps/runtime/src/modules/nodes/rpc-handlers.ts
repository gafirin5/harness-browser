import fs from 'node:fs/promises';
import path from 'node:path';
import { projectCreateSchema, terminalCreateSchema, worktreeCreateSchema, worktreeUpdateSchema } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import {
  createWorktree,
  git,
  isWorktreeHealthy,
  listBranches,
  removeWorktree,
  resolveRepo,
  slugifyBranch
} from '../../lib/git.js';
import { parseWith } from '../../lib/validation.js';
import { terminalManager } from '../terminals/manager.js';
import { getProject, listProjects } from '../projects/routes.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import type { NodeRpcHandler } from './client.js';

export function createNodeRpcHandlers(client?: { send: (msg: unknown) => void }): Record<string, NodeRpcHandler> {
  const handlers: Record<string, NodeRpcHandler> = {};
  const attachedAdapters = new Map<string, { readyState: number; send: (m: string) => void }>();

  // --- Ping & System ---
  handlers['node.ping'] = () => ({ pong: true });

  // --- Projects ---
  handlers['projects.list'] = () => listProjects();

  handlers['projects.create'] = async (params: unknown) => {
    const body = parseWith(projectCreateSchema, params);
    const repoPath = await resolveRepo(body.path);
    const id = newId();
    const createdAt = nowIso();
    db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      body.name,
      repoPath,
      createdAt
    );
    return { id, name: body.name, path: repoPath, createdAt };
  };

  handlers['projects.branches'] = async (params: unknown) => {
    const { projectId } = params as { projectId: string };
    const project = getProject(projectId);
    if (!project) throw notFound('Project tidak ditemukan.');
    return listBranches(project.path);
  };

  handlers['projects.delete'] = async (params: unknown) => {
    const { id } = params as { id: string };
    const project = getProject(id);
    if (!project) throw notFound('Project tidak ditemukan.');
    const runningTerminals = db
      .prepare(
        `SELECT count(*) AS total FROM terminals t
         JOIN worktrees w ON w.id = t.worktree_id
         WHERE w.project_id = ? AND t.status = 'running'`
      )
      .get(id) as { total: number };
    const runningSessions = db
      .prepare(
        `SELECT count(*) AS total FROM sessions s
         JOIN worktrees w ON w.id = s.worktree_id
         WHERE w.project_id = ? AND s.status = 'running'`
      )
      .get(id) as { total: number };
    if (runningTerminals.total > 0 || runningSessions.total > 0) {
      throw new AppError(422, 'PROJECT_IN_USE', 'Hentikan semua terminal dan sesi sebelum menghapus project.');
    }
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { ok: true };
  };

  // --- Worktrees ---
  handlers['worktrees.list'] = async (params: unknown) => {
    const { projectId } = (params ?? {}) as { projectId?: string };
    const rows = (projectId
      ? db.prepare('SELECT * FROM worktrees WHERE project_id = ? ORDER BY created_at ASC').all(projectId)
      : db.prepare('SELECT * FROM worktrees ORDER BY created_at ASC').all()) as unknown as Array<{
      id: string;
      project_id: string;
      branch: string;
      path: string;
      base_ref: string;
      task_status: string;
      note: string;
      created_at: string;
    }>;

    return Promise.all(
      rows.map(async (row) => {
        const healthy = await isWorktreeHealthy(row.path);
        return {
          id: row.id,
          projectId: row.project_id,
          branch: row.branch,
          path: row.path,
          baseRef: row.base_ref,
          status: healthy ? 'ready' : 'missing',
          taskStatus: row.task_status || 'todo',
          note: row.note || '',
          createdAt: row.created_at
        };
      })
    );
  };

  handlers['worktrees.create'] = async (params: unknown) => {
    const body = parseWith(worktreeCreateSchema, params);
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
      `INSERT INTO worktrees (id, project_id, branch, path, base_ref, status, task_status, note, created_at)
       VALUES (?, ?, ?, ?, ?, 'ready', 'todo', '', ?)`
    ).run(id, project.id, branch, directory, body.baseRef, createdAt);

    return {
      id,
      projectId: project.id,
      branch,
      path: directory,
      baseRef: body.baseRef,
      status: 'ready',
      taskStatus: 'todo',
      note: '',
      createdAt
    };
  };

  handlers['worktrees.update'] = async (params: unknown) => {
    const { id, ...data } = params as { id: string } & Record<string, unknown>;
    const row = getWorktreeRow(id);
    if (!row) throw notFound('Worktree tidak ditemukan.');
    const body = parseWith(worktreeUpdateSchema, data);
    db.prepare('UPDATE worktrees SET task_status = ?, note = ? WHERE id = ?').run(
      body.taskStatus ?? row.task_status,
      body.note ?? row.note,
      row.id
    );
    const updated = getWorktreeRow(row.id);
    if (!updated) throw notFound('Worktree tidak ditemukan.');
    const healthy = await isWorktreeHealthy(updated.path);
    return {
      id: updated.id,
      projectId: updated.project_id,
      branch: updated.branch,
      path: updated.path,
      baseRef: updated.base_ref,
      status: healthy ? 'ready' : 'missing',
      taskStatus: updated.task_status,
      note: updated.note,
      createdAt: updated.created_at
    };
  };

  handlers['worktrees.delete'] = async (params: unknown) => {
    const { id, force } = params as { id: string; force?: boolean };
    const row = getWorktreeRow(id);
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

    await removeWorktree(project.path, row.path, Boolean(force));
    db.prepare('DELETE FROM worktrees WHERE id = ?').run(row.id);
    await fs.rm(row.path, { recursive: true, force: true }).catch(() => undefined);
    return { ok: true };
  };

  // --- Terminals ---
  handlers['terminals.list'] = (params: unknown) => {
    const { worktreeId } = (params ?? {}) as { worktreeId?: string };
    return terminalManager.list(worktreeId);
  };

  handlers['terminals.create'] = (params: unknown) => {
    const body = parseWith(terminalCreateSchema, params);
    return terminalManager.create({
      worktreeId: body.worktreeId,
      title: body.title,
      kind: 'shell',
      command: process.env.SHELL || '/bin/bash',
      args: [],
      cols: body.cols,
      rows: body.rows
    });
  };

  handlers['terminals.restart'] = (params: unknown) => {
    const { id, cols, rows } = params as { id: string; cols?: number; rows?: number };
    return terminalManager.restart(id, cols ?? 120, rows ?? 32);
  };

  handlers['terminals.remove'] = (params: unknown) => {
    const { id } = params as { id: string };
    terminalManager.remove(id);
    return { ok: true };
  };

  handlers['terminals.input'] = (params: unknown) => {
    const { id, data } = params as { id: string; data: string };
    terminalManager.write(id, data);
    return { ok: true };
  };

  handlers['terminals.resize'] = (params: unknown) => {
    const { id, cols, rows } = params as { id: string; cols: number; rows: number };
    terminalManager.resize(id, cols, rows);
    return { ok: true };
  };

  handlers['terminal.attach'] = (params: unknown) => {
    const { terminalId } = params as { terminalId: string };
    if (!attachedAdapters.has(terminalId)) {
      const adapter = {
        readyState: 1,
        send: (payload: string) => {
          let event: unknown;
          try {
            event = JSON.parse(payload);
          } catch {
            event = payload;
          }
          client?.send({
            type: 'terminal.event',
            terminalId,
            event
          });
        }
      };
      attachedAdapters.set(terminalId, adapter);
      terminalManager.attach(terminalId, adapter as unknown as import('ws').WebSocket);
    }
    return { ok: true };
  };

  handlers['terminal.detach'] = (params: unknown) => {
    const { terminalId } = params as { terminalId: string };
    const adapter = attachedAdapters.get(terminalId);
    if (adapter) {
      terminalManager.detach(terminalId, adapter as unknown as import('ws').WebSocket);
      attachedAdapters.delete(terminalId);
    }
    return { ok: true };
  };

  // --- HTTP Universal Relay ---
  let nodeApp: any = null;
  handlers['http.request'] = async (params: unknown) => {
    const p = params as {
      method: string;
      url: string;
      body?: unknown;
      user?: { id: number; username: string; role: 'ADMIN' | 'VIEWER' };
    };
    if (!nodeApp) {
      const { createApp } = await import('../../app.js');
      nodeApp = createApp();
    }
    const request = (await import('supertest')).default;
    const req = (request(nodeApp) as any)[p.method.toLowerCase()](p.url);
    if (p.user) {
      req.set('x-dorado-trusted-user', JSON.stringify(p.user));
    }
    if (p.body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(p.method.toUpperCase())) {
      req.send(p.body);
    }
    const res = await req;
    return {
      status: res.status,
      headers: res.headers,
      body: res.body && Object.keys(res.body).length > 0 ? res.body : res.text
    };
  };

  return handlers;
}
