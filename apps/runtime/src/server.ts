import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { terminalManager } from './modules/terminals/manager.js';
import { startDispatcher, stopDispatcher } from './modules/orchestrator/dispatcher.js';
import { startHeartbeat, stopHeartbeat } from './modules/orchestrator/heartbeat.js';
import { startReconcile, stopReconcile } from './modules/orchestrator/reconcile.js';
import { setupTerminalWebSocket } from './ws.js';

terminalManager.reconcileOnStartup();

const app = createApp();
const server = http.createServer(app);
setupTerminalWebSocket(server);

server.listen(config.port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`[dorado] runtime listening on http://${process.env.HOST ?? '127.0.0.1'}:${config.port}`);
  console.log(`[dorado] data dir: ${config.dataDir}`);
  startDispatcher();
  startHeartbeat();
  startReconcile();
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dorado] shutting down (${signal})`);
  stopDispatcher();
  stopHeartbeat();
  stopReconcile();
  terminalManager.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
