import type { Request, RequestHandler } from 'express';
import { AppError, asyncHandler } from '../../lib/errors.js';
import { nodeManager, type NodeConnection } from './manager.js';

export function getNodeTarget(req: Request): NodeConnection | null {
  const header = req.get('x-dorado-node-id');
  const query = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
  const nodeId = (header || query)?.trim();
  if (!nodeId) return null;

  const nodeRow = nodeManager.get(nodeId);
  if (!nodeRow) {
    throw new AppError(404, 'NODE_NOT_FOUND', 'Node remote tidak ditemukan.');
  }

  const conn = nodeManager.getConnection(nodeId);
  if (!conn) {
    throw new AppError(503, 'NODE_DISCONNECTED', `Node remote "${nodeRow.name}" sedang offline.`);
  }
  return conn;
}

export function remoteNodeHttpProxy(): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const header = req.get('x-dorado-node-id');
    const query = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
    const nodeId = (header || query)?.trim();
    if (!nodeId) {
      next();
      return;
    }

    // Abaikan rute lokal controller dan rute dengan handler RPC eksplisit
    if (
      req.path.startsWith('/auth') ||
      req.path.startsWith('/users') ||
      req.path.startsWith('/audit') ||
      req.path.startsWith('/nodes') ||
      req.path.startsWith('/pairing') ||
      req.path.startsWith('/info') ||
      req.path.startsWith('/settings') ||
      req.path.startsWith('/projects') ||
      req.path.startsWith('/worktrees') ||
      req.path.startsWith('/terminals')
    ) {
      next();
      return;
    }

    const remote = getNodeTarget(req);
    if (!remote) {
      next();
      return;
    }

    const response = await remote.call<{
      status: number;
      headers: Record<string, string>;
      body: unknown;
    }>('http.request', {
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      user: res.locals.user
    });

    res.status(response.status);
    if (typeof response.body === 'object' && response.body !== null) {
      res.json(response.body);
    } else {
      res.send(response.body);
    }
  });
}
