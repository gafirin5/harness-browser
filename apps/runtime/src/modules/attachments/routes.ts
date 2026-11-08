import fs from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const ATTACH_DIR = '.dorado-attachments';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt', '.md', '.json', '.pdf']);

const querySchema = z.object({ name: z.string().trim().min(1).max(200) });

/** Nama file aman: buang path separator, `..`, dan pastikan ekstensi diizinkan. */
export function sanitizeAttachmentName(input: string): string {
  const base = path.basename(input.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '');
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  if (!cleaned) throw new AppError(422, 'INVALID_NAME', 'Nama file tidak valid.');
  const ext = path.extname(cleaned).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new AppError(422, 'INVALID_EXTENSION', `Ekstensi ${ext || '(kosong)'} tidak diizinkan.`);
  }
  return cleaned.slice(0, 120);
}

async function ensureExcluded(worktreePath: string): Promise<void> {
  const result = await gitRaw(worktreePath, ['rev-parse', '--git-path', 'info/exclude']);
  if (result.code !== 0) return;
  const excludePath = path.resolve(worktreePath, result.stdout.trim());
  let current = '';
  try {
    current = await fs.readFile(excludePath, 'utf8');
  } catch {
    current = '';
  }
  if (!current.split('\n').some((line) => line.trim() === `${ATTACH_DIR}/`)) {
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, `${current.replace(/\n?$/, '\n')}${ATTACH_DIR}/\n`, 'utf8');
  }
}

export const attachmentsRouter = Router();
attachmentsRouter.use(csrfGuard, requireAuth);

attachmentsRouter.post(
  '/worktrees/:id/attachments',
  express.raw({ type: 'application/octet-stream', limit: '6mb' }),
  asyncHandler(async (req, res) => {
    const worktree = getWorktreeRow(String(req.params.id ?? ''));
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const query = parseWith(querySchema, req.query);
    const name = sanitizeAttachmentName(query.name);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(422, 'EMPTY_FILE', 'File kosong.');
    }
    if (body.length > MAX_BYTES) {
      throw new AppError(422, 'FILE_TOO_LARGE', 'Ukuran file melebihi 5 MB.');
    }

    const dir = path.join(worktree.path, ATTACH_DIR);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), body);
    await ensureExcluded(worktree.path).catch(() => undefined);

    const relative = `${ATTACH_DIR}/${name}`;
    res.status(201).json({ data: { path: relative, mention: `@${relative}`, bytes: body.length } });
  })
);
