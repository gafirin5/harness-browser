import http from 'node:http';
import { Router, type Request, type Response } from 'express';
import { config } from '../../config.js';
import { AppError, notFound } from '../../lib/errors.js';
import { csrfGuard, requireAuth } from '../auth/middleware.js';
import { getWorktreeRow } from '../worktrees/routes.js';
import { localPortsForProject } from '../ssh/service.js';
import { INSPECTOR_SCRIPT } from './inspector.js';
import { detectWorktreePorts } from './ports.js';

const INSPECTOR_TAG = '<script src="/api/preview/inspector.js"></script>';

function injectInspector(html: string): string {
  const index = html.toLowerCase().lastIndexOf('</body>');
  if (index >= 0) return `${html.slice(0, index)}${INSPECTOR_TAG}${html.slice(index)}`;
  return html + INSPECTOR_TAG;
}

function proxyHandler(req: Request, res: Response): void {
  const worktreeId = String(req.params.worktreeId ?? '');
  const port = Number(req.params.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new AppError(422, 'INVALID_PORT', 'Port harus berupa angka 1024–65535.');
  }
  if (port === config.port) {
    throw new AppError(422, 'BLOCKED_PORT', 'Port runtime tidak boleh diproksi.');
  }
  const worktree = getWorktreeRow(worktreeId);
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Preview hanya mendukung GET/HEAD.');
  }

  const subPath = req.params[0] ? `/${req.params[0]}` : '/';
  const queryIndex = req.originalUrl.indexOf('?');
  const search = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
  const inspect = search.includes('inspect=1');

  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (['host', 'cookie', 'connection', 'content-length', 'accept-encoding', 'x-dorado-node-id'].includes(lower))
      continue;
    headers[key] = value;
  }
  headers['accept-encoding'] = 'identity';

  const upstream = http.request(
    { host: '127.0.0.1', port, path: `${subPath}${search}`, method: req.method, headers },
    (up) => {
      const type = String(up.headers['content-type'] ?? '');
      const isHtml = type.includes('text/html');
      res.status(up.statusCode ?? 502);
      for (const [key, value] of Object.entries(up.headers)) {
        if (value === undefined) continue;
        const lower = key.toLowerCase();
        if (
          [
            'x-frame-options',
            'content-security-policy',
            'content-security-policy-report-only',
            'content-encoding',
            'content-length',
            'transfer-encoding'
          ].includes(lower)
        ) {
          continue;
        }
        res.setHeader(key, value);
      }
      // Ganti CSP/XFO milik app target agar halaman Dorado boleh menempelkan iframe.
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");

      if (isHtml && req.method === 'GET') {
        const chunks: Buffer[] = [];
        up.on('data', (chunk) => chunks.push(chunk as Buffer));
        up.on('end', () => {
          let body = Buffer.concat(chunks).toString('utf8');
          if (inspect) body = injectInspector(body);
          res.setHeader('Content-Length', String(Buffer.byteLength(body)));
          res.end(body);
        });
      } else {
        up.pipe(res);
      }
    }
  );
  upstream.on('error', (error) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(502).json({ error: { code: 'PREVIEW_ERROR', message: (error as Error).message.slice(0, 300) } });
  });
  upstream.setTimeout(15_000, () => upstream.destroy(new Error('Preview timeout.')));
  upstream.end();
}

export const previewRouter = Router();
previewRouter.use(csrfGuard, requireAuth);

previewRouter.get('/worktrees/:id/ports', (req, res) => {
  const worktree = getWorktreeRow(String(req.params.id ?? ''));
  if (!worktree) throw notFound('Worktree tidak ditemukan.');
  const detected = detectWorktreePorts(worktree.path);
  const sshPorts = localPortsForProject(worktree.project_id);
  const ports = Array.from(new Set([...detected, ...sshPorts])).sort((a, b) => a - b);
  res.json({ data: { ports } });
});

previewRouter.get('/preview/inspector.js', (_req, res) => {
  res.type('application/javascript').send(INSPECTOR_SCRIPT);
});

previewRouter.all(['/preview/:worktreeId/:port', '/preview/:worktreeId/:port/*'], proxyHandler);
