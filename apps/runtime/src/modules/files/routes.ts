import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const MAX_FILE_BYTES = 1024 * 1024;
const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache', '__pycache__', '.venv', 'venv']);

const querySchema = z.object({
  worktreeId: z.string().min(1),
  path: z.string().max(1000).default('')
});

const writeSchema = z.object({
  worktreeId: z.string().min(1),
  path: z.string().min(1).max(1000),
  content: z.string().max(MAX_FILE_BYTES)
});

const createSchema = z.object({
  worktreeId: z.string().min(1),
  path: z.string().min(1).max(1000),
  type: z.enum(['file', 'dir']),
  content: z.string().max(MAX_FILE_BYTES).optional().default('')
});

const renameSchema = z.object({
  worktreeId: z.string().min(1),
  from: z.string().min(1).max(1000),
  to: z.string().min(1).max(1000)
});

function resolveWorktree(worktreeId: string): string {
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  return worktree.path;
}

function normalizeRelative(input: string): string {
  if (input.includes('\0')) throw new AppError(422, 'INVALID_PATH', 'Path tidak valid.');
  if (input.startsWith('/') || path.isAbsolute(input)) throw new AppError(422, 'INVALID_PATH', 'Path harus relatif.');
  const normalized = path.posix.normalize(input.replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new AppError(422, 'INVALID_PATH', 'Path keluar dari worktree.');
  }
  return normalized === '.' ? '' : normalized;
}

function assertWithin(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(422, 'INVALID_PATH', 'Path keluar dari worktree.');
  }
}

function assertNotIgnored(relativePath: string): void {
  const segments = relativePath.split('/').filter(Boolean);
  if (segments.some((segment) => IGNORED.has(segment))) {
    throw new AppError(422, 'IGNORED_PATH', 'Folder tersebut tidak dapat diakses dari file explorer.');
  }
}

async function safeTarget(worktreeId: string, relativeInput: string): Promise<{ root: string; relative: string; target: string }> {
  const root = resolveWorktree(worktreeId);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    throw notFound('Path worktree tidak ditemukan.');
  }
  const relative = normalizeRelative(relativeInput);
  assertNotIgnored(relative);
  const target = path.resolve(realRoot, relative);
  assertWithin(realRoot, target);
  return { root: realRoot, relative, target };
}

function languageFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.json': 'json',
    '.md': 'markdown',
    '.css': 'css',
    '.html': 'html',
    '.sh': 'shell',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.sql': 'sql',
    '.toml': 'ini',
    '.env': 'ini'
  };
  return map[ext] ?? 'text';
}

export const filesRouter = Router();
filesRouter.use(csrfGuard, requireAuth);

filesRouter.get(
  '/tree',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    const { root, relative, target } = await safeTarget(query.worktreeId, query.path);
    let entries;
    try {
      assertWithin(root, await fs.realpath(target));
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      throw notFound('Folder tidak ditemukan.');
    }

    const result = await Promise.all(
      entries
        .filter((entry) => !IGNORED.has(entry.name))
        .map(async (entry) => {
          const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) return { name: entry.name, path: entryPath, type: 'dir' as const };
          if (entry.isSymbolicLink()) return { name: entry.name, path: entryPath, type: 'symlink' as const };
          return { name: entry.name, path: entryPath, type: 'file' as const };
        })
    );

    result.sort((a, b) => {
      if (a.type !== b.type) {
        if (a.type === 'dir') return -1;
        if (b.type === 'dir') return 1;
      }
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });

    res.json({ data: result.slice(0, 1000), path: relative });
  })
);

filesRouter.get(
  '/content',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    if (!query.path) throw new AppError(422, 'INVALID_PATH', 'Path file wajib diisi.');
    const { root, target, relative } = await safeTarget(query.worktreeId, query.path);
    let stat;
    try {
      assertWithin(root, await fs.realpath(target));
      stat = await fs.stat(target);
    } catch {
      throw notFound('File tidak ditemukan.');
    }
    if (!stat.isFile()) throw new AppError(422, 'NOT_FILE', 'Path bukan file.');
    if (stat.size > MAX_FILE_BYTES) {
      throw new AppError(422, 'FILE_TOO_LARGE', 'File lebih besar dari 1 MB.');
    }

    const buffer = await fs.readFile(target);
    if (buffer.includes(0)) {
      res.json({ data: { path: relative, binary: true, size: stat.size, language: 'binary', content: '' } });
      return;
    }

    res.json({
      data: {
        path: relative,
        binary: false,
        size: stat.size,
        language: languageFor(relative),
        content: buffer.toString('utf8')
      }
    });
  })
);

filesRouter.put(
  '/content',
  asyncHandler(async (req, res) => {
    const body = parseWith(writeSchema, req.body);
    const { root, target, relative } = await safeTarget(body.worktreeId, body.path);
    const parent = path.dirname(target);
    try {
      assertWithin(root, await fs.realpath(parent));
      if (await fs.stat(target).then(() => true).catch(() => false)) {
        assertWithin(root, await fs.realpath(target));
      }
    } catch {
      throw notFound('Folder induk tidak ditemukan.');
    }
    await fs.writeFile(target, body.content, 'utf8');
    const stat = await fs.stat(target);
    res.json({ data: { path: relative, size: stat.size, mtime: stat.mtime.toISOString() } });
  })
);

filesRouter.post(
  '/create',
  asyncHandler(async (req, res) => {
    const body = parseWith(createSchema, req.body);
    const { root, relative, target } = await safeTarget(body.worktreeId, body.path);
    const parent = path.dirname(target);
    try {
      assertWithin(root, await fs.realpath(parent));
    } catch {
      throw notFound('Folder induk tidak ditemukan.');
    }
    const exists = await fs.stat(target).then(() => true).catch(() => false);
    if (exists) throw new AppError(409, 'ALREADY_EXISTS', 'File atau folder sudah ada.');
    if (body.type === 'dir') {
      await fs.mkdir(target);
    } else {
      await fs.writeFile(target, body.content, { encoding: 'utf8', flag: 'wx' });
    }
    res.status(201).json({ data: { path: relative, type: body.type } });
  })
);

filesRouter.post(
  '/rename',
  asyncHandler(async (req, res) => {
    const body = parseWith(renameSchema, req.body);
    const source = await safeTarget(body.worktreeId, body.from);
    const destination = await safeTarget(body.worktreeId, body.to);
    try {
      assertWithin(source.root, await fs.realpath(source.target));
    } catch {
      throw notFound('File atau folder sumber tidak ditemukan.');
    }
    const destinationParent = path.dirname(destination.target);
    try {
      assertWithin(destination.root, await fs.realpath(destinationParent));
    } catch {
      throw notFound('Folder tujuan tidak ditemukan.');
    }
    const exists = await fs.stat(destination.target).then(() => true).catch(() => false);
    if (exists) throw new AppError(409, 'ALREADY_EXISTS', 'Tujuan rename sudah ada.');
    await fs.rename(source.target, destination.target);
    res.json({ data: { from: source.relative, to: destination.relative } });
  })
);

filesRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(querySchema, req.query);
    if (!query.path) throw new AppError(422, 'INVALID_PATH', 'Path wajib diisi.');
    const { root, target } = await safeTarget(query.worktreeId, query.path);
    try {
      assertWithin(root, await fs.realpath(target));
    } catch {
      throw notFound('File atau folder tidak ditemukan.');
    }
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(target);
      if (entries.length > 0) throw new AppError(422, 'DIRECTORY_NOT_EMPTY', 'Folder tidak kosong.');
      await fs.rmdir(target);
    } else {
      await fs.unlink(target);
    }
    res.status(204).end();
  })
);
