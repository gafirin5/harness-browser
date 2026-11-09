import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../lib/errors.js';
import { gitRaw } from '../../lib/git-raw.js';

export const ATTACH_DIR = '.dorado-attachments';
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.txt', '.md', '.json', '.pdf']);

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

/** Pastikan `.dorado-attachments/` ada di git info/exclude (agar tak masuk status). */
export async function ensureExcluded(worktreePath: string): Promise<void> {
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

/** Tulis attachment ke worktree dan kembalikan path relatif + mention `@`. */
export async function writeAttachment(
  worktreePath: string,
  name: string,
  data: Buffer
): Promise<{ path: string; mention: string; bytes: number }> {
  if (data.length === 0) throw new AppError(422, 'EMPTY_FILE', 'File kosong.');
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AppError(422, 'FILE_TOO_LARGE', 'Ukuran file melebihi 5 MB.');
  const dir = path.join(worktreePath, ATTACH_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), data);
  await ensureExcluded(worktreePath).catch(() => undefined);
  const relative = `${ATTACH_DIR}/${name}`;
  return { path: relative, mention: `@${relative}`, bytes: data.length };
}
