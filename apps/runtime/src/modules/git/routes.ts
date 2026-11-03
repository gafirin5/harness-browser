import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const statusQuery = z.object({ worktreeId: z.string().min(1) });
const diffQuery = z.object({
  worktreeId: z.string().min(1),
  path: z.string().min(1).max(1000),
  staged: z.enum(['0', '1']).optional().default('0')
});

interface ChangedFile {
  path: string;
  status: string;
  index: string;
  worktree: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

function resolveWorktree(worktreeId: string): string {
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  return worktree.path;
}

function safeRelative(input: string): string {
  if (input.includes('\0') || path.isAbsolute(input)) throw new AppError(422, 'INVALID_PATH', 'Path tidak valid.');
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new AppError(422, 'INVALID_PATH', 'Path keluar dari worktree.');
  }
  return normalized;
}

function parseStatus(output: string): {
  branch: string | null;
  ahead: number;
  behind: number;
  files: ChangedFile[];
  clean: boolean;
} {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: ChangedFile[] = [];

  for (const line of output.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const text = line.slice(3);
      const tracking = /\[(.*?)\]/.exec(text)?.[1] ?? '';
      const branchRaw = text.split('...')[0] ?? text;
      branch = branchRaw.replace(/^No commits yet on /, '').trim() || null;
      const aheadMatch = /ahead (\d+)/.exec(tracking);
      const behindMatch = /behind (\d+)/.exec(tracking);
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
      behind = behindMatch ? Number(behindMatch[1]) : 0;
      continue;
    }
    if (line.length < 4) continue;
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    let filePath = line.slice(3).trim();
    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop() ?? filePath;
    files.push({
      path: filePath,
      status: (index === '?' ? '??' : `${index}${worktree}`).trim() || 'M',
      index,
      worktree,
      staged: index !== ' ' && index !== '?',
      unstaged: worktree !== ' ',
      untracked: index === '?' && worktree === '?'
    });
  }

  return { branch, ahead, behind, files, clean: files.length === 0 };
}

export const gitRouter = Router();
gitRouter.use(csrfGuard, requireAuth);

gitRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const query = parseWith(statusQuery, req.query);
    const cwd = resolveWorktree(query.worktreeId);
    const result = await gitRaw(cwd, ['status', '--porcelain=v1', '--branch']);
    res.json({ data: parseStatus(result.stdout) });
  })
);

gitRouter.get(
  '/diff',
  asyncHandler(async (req, res) => {
    const query = parseWith(diffQuery, req.query);
    const cwd = resolveWorktree(query.worktreeId);
    const relative = safeRelative(query.path);
    const target = path.resolve(cwd, relative);
    if (path.relative(cwd, target).startsWith('..')) {
      throw new AppError(422, 'INVALID_PATH', 'Path keluar dari worktree.');
    }

    const args =
      query.staged === '1'
        ? ['diff', '--cached', '--no-color', '--', relative]
        : ['diff', '--no-color', '--', relative];
    let result = await gitRaw(cwd, args);

    if (!result.stdout.trim() && query.staged === '0') {
      const exists = await fs.stat(target).then(() => true).catch(() => false);
      if (exists) {
        result = await gitRaw(cwd, ['diff', '--no-index', '--no-color', '--', '/dev/null', relative]);
      }
    }

    const MAX = 500 * 1024;
    const truncated = result.stdout.length > MAX;
    res.json({
      data: {
        path: relative,
        staged: query.staged === '1',
        diff: truncated ? result.stdout.slice(0, MAX) : result.stdout,
        truncated
      }
    });
  })
);