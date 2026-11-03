import type { ZodTypeAny, z } from 'zod';
import { AppError, validationError } from './errors.js';

export function parseWith<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function parseId(value: string, field = 'id'): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(422, 'VALIDATION_ERROR', `Parameter ${field} tidak valid.`, { [field]: 'ID tidak valid.' });
  }
  return parsed;
}
