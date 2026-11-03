import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function validationError(error: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = error.issues[0]?.message ?? 'Data tidak valid.';
  return new AppError(422, 'VALIDATION_ERROR', first, fields);
}

export function notFound(message = 'Data tidak ditemukan.'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

export function invalidTransition(message: string): AppError {
  return new AppError(422, 'INVALID_TRANSITION', message);
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    const appError = validationError(error);
    res.status(appError.status).json({ error: { code: appError.code, message: appError.message, fields: appError.fields } });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) }
    });
    return;
  }

  const pgError = error as { code?: string; constraint?: string; message?: string };
  if (pgError.code === '23505') {
    const duplicateMessages: Record<string, string> = {
      providers_name_lower_ux: 'Nama provider sudah digunakan. Gunakan nama lain.',
      agents_code_lower_ux: 'Kode agent sudah terdaftar. Gunakan kode unik lainnya.',
      users_email_lower_ux: 'Email sudah terdaftar.',
      tasks_client_request_ux: 'Permintaan task ini sudah diproses.',
      tasks_code_ux: 'Kode task sudah digunakan.'
    };
    const message = duplicateMessages[pgError.constraint ?? ''] ?? 'Data sudah terdaftar. Gunakan nilai lain.';
    res.status(409).json({ error: { code: 'CONFLICT', message } });
    return;
  }

  logger.error({ err: error, method: req.method, path: req.path }, 'Unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server.' } });
}
