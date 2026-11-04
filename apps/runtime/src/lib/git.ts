import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '../lib/errors.js';

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return stdout;
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new AppError(422, 'GIT_ERROR', (err.stderr || err.message || 'Perintah git gagal.').trim().slice(0, 800));
  }
}

export async function resolveRepo(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    throw new AppError(422, 'INVALID_PATH', 'Path repository tidak ditemukan.');
  }
  const stat = await fs.stat(real).catch(() => null);
  if (!stat?.isDirectory()) throw new AppError(422, 'INVALID_PATH', 'Path harus berupa direktori.');
  const root = (await git(real, ['rev-parse', '--show-toplevel'])).trim();
  if (path.resolve(root) !== path.resolve(real)) {
    throw new AppError(422, 'NOT_REPO_ROOT', `Path tersebut bukan root repository Git. Root: ${root}`);
  }
  return real;
}

export async function listBranches(repoPath: string): Promise<string[]> {
  const output = await git(repoPath, ['for-each-ref', 'refs/heads', '--format=%(refname:short)']);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

export async function currentBranch(repoPath: string): Promise<string | null> {
  try {
    return (await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    return null;
  }
}

export async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(repoPath, ['rev-parse', '--verify', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function createWorktree(
  repoPath: string,
  targetPath: string,
  branch: string,
  baseRef: string
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (await branchExists(repoPath, branch)) {
    await git(repoPath, ['worktree', 'add', targetPath, branch]);
  } else {
    await git(repoPath, ['worktree', 'add', '-b', branch, targetPath, baseRef]);
  }
}

export async function removeWorktree(repoPath: string, targetPath: string, force = false): Promise<void> {
  const args = ['worktree', 'remove', targetPath];
  if (force) args.push('--force');
  await git(repoPath, args);
  await git(repoPath, ['worktree', 'prune']).catch(() => '');
}

export async function isWorktreeHealthy(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export function slugifyBranch(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  return slug || 'worktree';
}
