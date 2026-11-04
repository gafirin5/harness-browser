import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler, notFound } from '../../lib/errors.js';
import { parseWith } from '../../lib/validation.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';

interface SearchMatch {
  line: number;
  column: number;
  text: string;
}

interface SearchFile {
  path: string;
  matches: SearchMatch[];
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const searchSchema = z.object({
  worktreeId: z.string().min(1),
  q: z.string().min(1).max(200),
  caseSensitive: z.enum(['0', '1']).optional().default('0'),
  regex: z.enum(['0', '1']).optional().default('0'),
  maxResults: z.coerce.number().int().min(1).max(200).optional().default(100)
});

function run(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 15_000 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' });
          return;
        }
        const raw = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        const code = typeof raw === 'number' ? raw : (error as { killed?: boolean }).killed ? 124 : 127;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? error.message });
      }
    );
  });
}

let ripgrepChecked = false;
let ripgrepAvailable = false;

async function hasRipgrep(): Promise<boolean> {
  if (ripgrepChecked) return ripgrepAvailable;
  const result = await run('rg', ['--version'], process.cwd());
  ripgrepAvailable = result.code === 0;
  ripgrepChecked = true;
  return ripgrepAvailable;
}

function normalizePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function clip(value: string): string {
  return value.replace(/\r?\n$/, '').slice(0, 400);
}

function groupResults(
  entries: Array<{ path: string; line: number; column: number; text: string }>,
  maxResults: number
): { files: SearchFile[]; total: number; truncated: boolean } {
  const grouped = new Map<string, SearchMatch[]>();
  let total = 0;
  let truncated = false;
  for (const entry of entries) {
    if (total >= maxResults) {
      truncated = true;
      break;
    }
    const match: SearchMatch = { line: entry.line, column: entry.column, text: clip(entry.text) };
    const existing = grouped.get(entry.path);
    if (existing) existing.push(match);
    else grouped.set(entry.path, [match]);
    total += 1;
  }
  const files = Array.from(grouped.entries())
    .map(([filePath, matches]) => ({ path: filePath, matches }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { files, total, truncated };
}

async function searchWithRipgrep(
  cwd: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean,
  maxResults: number
): Promise<{ files: SearchFile[]; total: number; truncated: boolean; error?: string }> {
  const args = ['--json', '--line-number', '--no-heading', '--color', 'never', '--max-count', '20'];
  if (!caseSensitive) args.push('-i');
  if (!regex) args.push('-F');
  args.push('-e', query, '.');
  const result = await run('rg', args, cwd);

  const entries: Array<{ path: string; line: number; column: number; text: string }> = [];
  for (const raw of result.stdout.split('\n')) {
    if (!raw.trim()) continue;
    let event: {
      type?: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
        submatches?: Array<{ start?: number }>;
      };
    };
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type !== 'match' || !event.data) continue;
    const path = event.data.path?.text;
    const line = event.data.line_number;
    if (!path || typeof line !== 'number') continue;
    entries.push({
      path: normalizePath(path),
      line,
      column: (event.data.submatches?.[0]?.start ?? 0) + 1,
      text: event.data.lines?.text ?? ''
    });
    if (entries.length >= maxResults + 1) break;
  }

  if (result.code === 2 && entries.length === 0) {
    return {
      files: [],
      total: 0,
      truncated: false,
      error: (result.stderr || 'Pencarian gagal.').split('\n')[0]?.slice(0, 300)
    };
  }
  return groupResults(entries, maxResults);
}

async function searchWithGitGrep(
  cwd: string,
  query: string,
  caseSensitive: boolean,
  regex: boolean,
  maxResults: number
): Promise<{ files: SearchFile[]; total: number; truncated: boolean; error?: string }> {
  const args = ['grep', '-n', '-I', '--no-color', '--full-name'];
  if (!caseSensitive) args.push('-i');
  if (!regex) args.push('-F');
  args.push('-e', query);
  const result = await run('git', args, cwd);
  if (result.code !== 0 && result.code !== 1) {
    return {
      files: [],
      total: 0,
      truncated: false,
      error: (result.stderr || 'Pencarian gagal.').split('\n')[0]?.slice(0, 300)
    };
  }
  const entries: Array<{ path: string; line: number; column: number; text: string }> = [];
  for (const raw of result.stdout.split('\n')) {
    if (!raw) continue;
    const first = raw.indexOf(':');
    const second = raw.indexOf(':', first + 1);
    if (first <= 0 || second <= first) continue;
    const path = raw.slice(0, first);
    const line = Number.parseInt(raw.slice(first + 1, second), 10);
    if (!Number.isFinite(line)) continue;
    entries.push({ path, line, column: 1, text: raw.slice(second + 1) });
    if (entries.length >= maxResults + 1) break;
  }
  return groupResults(entries, maxResults);
}

export const searchRouter = Router();
searchRouter.use(csrfGuard, requireAuth);

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = parseWith(searchSchema, req.query);
    const worktree = getWorktreeRow(query.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    if (!fs.existsSync(worktree.path)) {
      throw new AppError(422, 'WORKTREE_MISSING', 'Path worktree tidak ditemukan.');
    }

    const started = Date.now();
    const caseSensitive = query.caseSensitive === '1';
    const regex = query.regex === '1';
    const engine = (await hasRipgrep()) ? 'ripgrep' : 'git-grep';
    const outcome =
      engine === 'ripgrep'
        ? await searchWithRipgrep(worktree.path, query.q, caseSensitive, regex, query.maxResults)
        : await searchWithGitGrep(worktree.path, query.q, caseSensitive, regex, query.maxResults);

    if (outcome.error) throw new AppError(422, 'SEARCH_ERROR', outcome.error);

    res.json({
      data: {
        query: query.q,
        files: outcome.files,
        total: outcome.total,
        truncated: outcome.truncated
      },
      meta: {
        engine,
        caseSensitive,
        regex,
        maxResults: query.maxResults,
        durationMs: Date.now() - started
      }
    });
  })
);
