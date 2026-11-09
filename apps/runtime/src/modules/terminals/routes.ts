import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { terminalCreateSchema, terminalInputSchema } from '@dorado/shared';
import { config } from '../../config.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getNodeTarget } from '../nodes/dispatch.js';
import { parseChatBlocks } from '../sessions/chat.js';
import { terminalManager } from './manager.js';

export const terminalsRouter = Router();
terminalsRouter.use(csrfGuard, requireAuth);

terminalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('terminals.list', { worktreeId: req.query.worktreeId });
      res.json({ data });
      return;
    }
    const worktreeId = typeof req.query.worktreeId === 'string' ? req.query.worktreeId : undefined;
    res.json({ data: terminalManager.list(worktreeId) });
  })
);

terminalsRouter.get(
  '/:id/chat-blocks',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');
    const logPath = path.join(config.logsDir, `${id}.log`);
    const raw = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    res.json({ data: parseChatBlocks(raw.slice(-200000)) });
  })
);

terminalsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('terminals.create', req.body);
      res.status(201).json({ data });
      return;
    }
    const body = parseWith(terminalCreateSchema, req.body);
    const terminal = terminalManager.create({
      worktreeId: body.worktreeId,
      title: body.title,
      kind: 'shell',
      command: process.env.SHELL || '/bin/bash',
      args: [],
      cols: body.cols,
      rows: body.rows
    });
    res.status(201).json({ data: terminal });
  })
);

terminalsRouter.post(
  '/:id/input',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('terminals.input', { id: req.params.id, ...req.body });
      res.json({ data });
      return;
    }
    const id = String(req.params.id ?? '');
    if (!terminalManager.getRow(id)) throw notFound('Terminal tidak ditemukan.');
    const body = parseWith(terminalInputSchema, req.body);
    terminalManager.write(id, body.data);
    res.json({ data: { ok: true } });
  })
);

terminalsRouter.post(
  '/:id/restart',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      const data = await remote.call('terminals.restart', { id: req.params.id, ...req.body });
      res.json({ data });
      return;
    }
    const cols = Number(req.body?.cols ?? 120);
    const rows = Number(req.body?.rows ?? 32);
    const terminal = terminalManager.restart(
      String(req.params.id ?? ''),
      Number.isFinite(cols) ? cols : 120,
      Number.isFinite(rows) ? rows : 32
    );
    res.json({ data: terminal });
  })
);

terminalsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const remote = getNodeTarget(req);
    if (remote) {
      await remote.call('terminals.remove', { id: req.params.id });
      res.status(204).end();
      return;
    }
    if (!terminalManager.getRow(String(req.params.id ?? ''))) throw notFound('Terminal tidak ditemukan.');
    terminalManager.remove(String(req.params.id ?? ''));
    res.status(204).end();
  })
);
