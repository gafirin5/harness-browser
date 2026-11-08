import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { db } from './db/index.js';
import { config } from './config.js';
import { AppError, errorHandler } from './lib/errors.js';
import { rateLimit } from './modules/auth/middleware.js';
import { authRouter, pairingRouter } from './modules/auth/routes.js';
import { getSessionFromRequest } from './modules/auth/session.js';
import { usersRouter } from './modules/auth/users.routes.js';
import { auditRouter } from './modules/audit/routes.js';
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
import { quickCommandsRouter } from './modules/quick-commands/routes.js';
import { reviewRouter } from './modules/review/routes.js';
import { agentApiRouter } from './modules/agent-api/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { nodesRouter } from './modules/nodes/routes.js';
import { remoteNodeHttpProxy } from './modules/nodes/dispatch.js';
import { automationsRouter } from './modules/automations/routes.js';
import { racesRouter } from './modules/races/routes.js';
import { triageRouter } from './modules/triage/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { attachmentsRouter } from './modules/attachments/routes.js';
import { profilesRouter } from './modules/profiles/routes.js';
import { previewRouter } from './modules/preview/routes.js';
import { updateRouter } from './modules/update/routes.js';

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
      res.json({ status: 'ok', time: new Date().toISOString(), version: config.version });
    } catch {
      res.status(503).json({ status: 'unavailable', time: new Date().toISOString(), version: config.version });
    }
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/auth/login' || req.path === '/auth/pair') {
      next();
      return;
    }
    if (req.path.startsWith('/orchestrator/agent/')) {
      next();
      return;
    }
    if (req.path.startsWith('/agent/')) {
      next();
      return;
    }
    const trustedUser = req.get('x-dorado-trusted-user');
    if (trustedUser) {
      try {
        res.locals.user = JSON.parse(trustedUser);
        res.locals.sessionId = 'trusted-node-proxy';
        next();
        return;
      } catch {
        // lanjut ke verifikasi session biasa
      }
    }
    const session = getSessionFromRequest(req);
    if (!session) {
      next(new AppError(401, 'UNAUTHORIZED', 'Silakan masuk terlebih dahulu.'));
      return;
    }
    res.locals.user = session.user;
    res.locals.sessionId = session.id;
    next();
  });

  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }
    if (req.path.startsWith('/auth/')) {
      next();
      return;
    }
    if (req.path.startsWith('/orchestrator/agent/')) {
      next();
      return;
    }
    if (req.path.startsWith('/agent/')) {
      next();
      return;
    }
    if (req.path.startsWith('/sessions/inbox')) {
      next();
      return;
    }
    if (req.path.startsWith('/notifications')) {
      next();
      return;
    }
    const user = res.locals.user as { role?: string } | undefined;
    if (!user || user.role !== 'ADMIN') {
      next(new AppError(403, 'FORBIDDEN', 'Mode viewer tidak diizinkan melakukan perubahan.'));
      return;
    }
    next();
  });

  app.use('/api', remoteNodeHttpProxy());

  app.use('/api/agent', agentApiRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/nodes', nodesRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/audit', auditRouter);
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
  app.use('/api/quick-commands', quickCommandsRouter);
  app.use('/api/review', reviewRouter);
  app.use('/api/automations', automationsRouter);
  app.use('/api/orchestrator/agent', orchestratorAgentRouter);
  app.use('/api/orchestrator', orchestratorRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/update', updateRouter);
  app.use('/api', attachmentsRouter);
  app.use('/api', racesRouter);
  app.use('/api', triageRouter);
  app.use('/api', previewRouter);

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
