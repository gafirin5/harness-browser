import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { startDispatcher, stopDispatcher } from './dispatcher/index.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat/index.js';
import { startReconcile, stopReconcile } from './reconcile/index.js';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, 'Orca API berjalan');
  startDispatcher();
  startHeartbeat();
  startReconcile();
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Mematikan server...');
  stopDispatcher();
  stopHeartbeat();
  stopReconcile();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
