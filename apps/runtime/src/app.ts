import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { db } from './db/index.js';
import { errorHandler } from './lib/errors.js';
import { rateLimit } from './modules/auth/middleware.js';
import { authRouter, pairingRouter } from './modules/auth/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { worktreesRouter } from './modules/worktrees/routes.js';
import { terminalsRouter } from './modules/terminals/routes.js';
import { agentsRouter, sessionsRouter } from './modules/sessions/routes.js';
import { filesRouter } from './modules/files/routes.js';
import { gitRouter } from './modules/git/routes.js';
import { githubRouter } from './modules/github/routes.js';
import { infoRouter } from './modules/info/routes.js';
import { orchestratorAgentRouter, orchestratorRouter } from './modules/orchestrator/routes.js';
import { searchRouter } from './modules/search/routes.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    next();
  });

  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', (req, _res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }
    try {
      rateLimit(`api:${req.ip ?? 'unknown'}`, 300, 60_000);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      res.json({ status: 'ok', time: new Date().toISOString(), version: '0.1.0' });
    } catch {
      res.status(503).json({ status: 'unavailable', time: new Date().toISOString(), version: '0.1.0' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/pairing', pairingRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/worktrees', worktreesRouter);
  app.use('/api/terminals', terminalsRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/git', gitRouter);
  app.use('/api/github', githubRouter);
  app.use('/api/info', infoRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/orchestrator/agent', orchestratorAgentRouter);
  app.use('/api/orchestrator', orchestratorRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}