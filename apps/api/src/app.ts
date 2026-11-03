import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { queryOne } from './db/pool.js';
import { errorHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { csrfGuard } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { providersRouter } from './modules/providers/routes.js';
import { agentsRouter } from './modules/agents/routes.js';
import { tasksRouter } from './modules/tasks/routes.js';
import { agentApiRouter } from './modules/agentApi/routes.js';
import { dashboardRouter, eventsRouter } from './modules/dashboard/routes.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      logger.info(
        { method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started },
        'request'
      );
    });
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    if (config.cookieSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use('/api', (req, res, next) => {
    if (req.path === '/events/stream') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(csrfGuard(config.allowedOrigins));

  app.get('/api/health', async (_req, res) => {
    try {
      await queryOne('SELECT 1 AS ok');
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/agent', agentApiRouter);
  app.use('/api', dashboardRouter);
  app.use('/api', eventsRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } });
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1y', immutable: true }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
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
