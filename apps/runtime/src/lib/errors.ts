import type { NextFunction, Request, Response } from 'express';

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

export function notFound(message = 'Data tidak ditemukan.'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, fields: error.fields } });
    return;
  }
  const zodError = error as { issues?: Array<{ path: Array<string | number>; message: string }> };
  if (zodError?.issues) {
    const fields: Record<string, string> = {};
    for (const issue of zodError.issues) fields[issue.path.join('.') || '_'] = issue.message;
    res.status(422).json({ error: { code: 'VALIDATION_ERROR', message: zodError.issues[0]?.message, fields } });
    return;
  }
  console.error('[dorado] unhandled error', error);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada runtime.' } });
}

export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}