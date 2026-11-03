import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from '../lib/errors.js';

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Menjalankan git dan mengembalikan output juga saat exit code != 0 (mis. diff). */
export async function gitRaw(cwd: string, args: string[]): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    if (typeof err.code === 'number' && err.code !== 0) {
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? '', code: err.code };
    }
    throw new AppError(422, 'GIT_ERROR', (err.stderr || err.message || 'Perintah git gagal.').trim().slice(0, 800));
  }
}