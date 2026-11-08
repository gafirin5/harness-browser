import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { worktreeUpdateSchema } from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { hashAgentToken } from '../../lib/agent-token.js';
import { stripAnsi } from '../../lib/ansi.js';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { createWorktree, git, slugifyBranch } from '../../lib/git.js';
import { parseWith } from '../../lib/validation.js';
import { getProject } from '../projects/routes.js';
import { getAgent, listAgents } from '../sessions/agents.js';
import { startAgentSession } from '../sessions/service.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const sessionUpdateSchema = z
  .object({
    model: z.string().trim().max(100).optional(),
    messageCount: z.coerce.number().int().min(0).max(1_000_000).optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

const subagentCreateSchema = z.object({
  agentId: z.string().trim().min(1).max(60),
  branch: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1, 'Prompt wajib diisi.').max(20000)
});

const SUBAGENT_PER_PARENT_CAP = 4;

function resolveSession(req: { get: (name: string) => string | undefined }): { id: string; worktreeId: string } {
  const header = req.get('x-dorado-session-token') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AppError(401, 'AGENT_TOKEN_MISSING', 'Header x-dorado-session-token wajib diisi.');
  const row = db
    .prepare('SELECT id, worktree_id FROM sessions WHERE agent_token_hash = ?')
    .get(hashAgentToken(token)) as { id: string; worktree_id: string } | undefined;
  if (!row) throw new AppError(401, 'AGENT_TOKEN_INVALID', 'Token sesi agent tidak valid.');
  return { id: row.id, worktreeId: row.worktree_id };
}

export const agentApiRouter = Router();

agentApiRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const row = db
      .prepare('SELECT id, worktree_id, model, message_count, status FROM sessions WHERE id = ?')
      .get(session.id) as
      | { id: string; worktree_id: string; model: string; message_count: number; status: string }
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    res.json({
      data: {
        id: row.id,
        worktreeId: row.worktree_id,
        status: row.status,
        model: row.model,
        messageCount: row.message_count
      }
    });
  })
);

agentApiRouter.patch(
  '/session',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const row = db.prepare('SELECT id, model, message_count FROM sessions WHERE id = ?').get(session.id) as
      | { id: string; model: string; message_count: number }
      | undefined;
    if (!row) throw notFound('Sesi tidak ditemukan.');
    const body = parseWith(sessionUpdateSchema, req.body);
    const model = body.model ?? row.model;
    const messageCount = body.messageCount ?? row.message_count;
    db.prepare('UPDATE sessions SET model = ?, message_count = ? WHERE id = ?').run(model, messageCount, row.id);
    res.json({ data: { id: row.id, model, messageCount, updatedAt: nowIso() } });
  })
);

agentApiRouter.get(
  '/worktree',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const worktree = getWorktreeRow(session.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    res.json({
      data: {
        id: worktree.id,
        branch: worktree.branch,
        taskStatus: worktree.task_status,
        note: worktree.note,
        sessionId: session.id,
        updatedAt: nowIso()
      }
    });
  })
);

agentApiRouter.patch(
  '/worktree',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const worktree = getWorktreeRow(session.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const body = parseWith(worktreeUpdateSchema, req.body);
    db.prepare('UPDATE worktrees SET task_status = ?, note = ? WHERE id = ?').run(
      body.taskStatus ?? worktree.task_status,
      body.note ?? worktree.note,
      worktree.id
    );
    const updated = getWorktreeRow(worktree.id);
    if (!updated) throw notFound('Worktree tidak ditemukan.');
    res.json({
      data: {
        id: updated.id,
        branch: updated.branch,
        taskStatus: updated.task_status,
        note: updated.note,
        sessionId: session.id,
        updatedAt: nowIso()
      }
    });
  })
);

// --- Sub-agent (dorado-ctl) ---

agentApiRouter.get(
  '/agents',
  asyncHandler(async (req, res) => {
    resolveSession(req);
    res.json({ data: listAgents() });
  })
);

agentApiRouter.post(
  '/subagents',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const body = parseWith(subagentCreateSchema, req.body);
    const parentWorktree = getWorktreeRow(session.worktreeId);
    if (!parentWorktree) throw notFound('Worktree induk tidak ditemukan.');
    const running = db
      .prepare("SELECT count(*) AS total FROM sessions WHERE parent_session_id = ? AND status = 'running'")
      .get(session.id) as { total: number };
    if (running.total >= SUBAGENT_PER_PARENT_CAP) {
      throw new AppError(429, 'SUBAGENT_LIMIT', `Batas ${SUBAGENT_PER_PARENT_CAP} sub-agent aktif tercapai.`);
    }
    const agent = getAgent(body.agentId);
    if (!agent) throw new AppError(422, 'UNKNOWN_AGENT', 'Agent tidak dikenal.');
    if (!agent.installed) throw new AppError(422, 'AGENT_NOT_INSTALLED', `Agent ${agent.name} belum terpasang.`);
    const project = getProject(parentWorktree.project_id);
    if (!project) throw notFound('Project tidak ditemukan.');

    const worktreeId = newId();
    const branch =
      body.branch ?? `sub-${session.id.slice(0, 6)}-${slugifyBranch(body.agentId)}-${worktreeId.slice(0, 4)}`;
    const directory = path.join(config.worktreesDir, project.id, `${slugifyBranch(branch)}-${worktreeId.slice(0, 6)}`);
    const relative = path.relative(config.worktreesDir, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError(422, 'INVALID_PATH', 'Path worktree tidak valid.');
    }
    await createWorktree(project.path, directory, branch, parentWorktree.branch);
    db.prepare(
      'INSERT INTO worktrees (id, project_id, branch, path, base_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(worktreeId, project.id, branch, directory, parentWorktree.branch, 'ready', nowIso());
    const child = startAgentSession({
      worktreeId,
      agentId: body.agentId,
      title: `Sub-agent ${body.agentId}`,
      prompt: body.prompt,
      mode: 'run',
      parentSessionId: session.id
    });
    res.status(201).json({ data: { worktreeId, sessionId: child.id, branch } });
  })
);

agentApiRouter.get(
  '/subagents/diff/:worktreeId',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const worktreeId = String(req.params.worktreeId ?? '');
    const child = db
      .prepare('SELECT id FROM sessions WHERE worktree_id = ? AND parent_session_id = ?')
      .get(worktreeId, session.id) as { id: string } | undefined;
    if (!child) throw notFound('Sub-agent tidak ditemukan.');
    const worktree = getWorktreeRow(worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const diff = await git(worktree.path, ['diff', worktree.base_ref]).catch(() => '');
    res.json({ data: { worktreeId, branch: worktree.branch, diff } });
  })
);

agentApiRouter.get(
  '/subagents/:sessionId',
  asyncHandler(async (req, res) => {
    const session = resolveSession(req);
    const child = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND parent_session_id = ?')
      .get(String(req.params.sessionId ?? ''), session.id) as
      | { id: string; worktree_id: string; terminal_id: string; status: string }
      | undefined;
    if (!child) throw notFound('Sub-agent tidak ditemukan.');
    const worktree = getWorktreeRow(child.worktree_id);
    let transcript: string[] = [];
    const logPath = path.join(config.logsDir, `${child.terminal_id}.log`);
    if (fs.existsSync(logPath)) {
      transcript = stripAnsi(fs.readFileSync(logPath, 'utf8')).split('\n').filter(Boolean).slice(-30);
    }
    let gitStatus = '';
    if (worktree) gitStatus = await git(worktree.path, ['status', '--short']).catch(() => '');
    res.json({
      data: {
        sessionId: child.id,
        worktreeId: child.worktree_id,
        branch: worktree?.branch ?? '',
        status: child.status,
        transcript,
        gitStatus
      }
    });
  })
);
