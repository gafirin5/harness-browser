import crypto from 'node:crypto';
import { z, type ZodError, type ZodTypeAny } from 'zod';
import { AppError } from './errors.js';

export function parseWith<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function validationError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join('.') || '_'] = issue.message;
  return new AppError(422, 'VALIDATION_ERROR', error.issues[0]?.message ?? 'Data tidak valid.', fields);
}

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function randomId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 24);
}