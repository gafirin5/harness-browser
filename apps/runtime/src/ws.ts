import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { terminalClientMessageSchema } from '@dorado/shared';
import { terminalManager } from './modules/terminals/manager.js';
import { checkWsOrigin } from './modules/auth/middleware.js';
import { readSessionFromCookieHeader } from './modules/auth/session.js';

function reject(socket: import('node:stream').Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function setupTerminalWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = /^\/ws\/terminals\/([A-Za-z0-9]+)$/.exec(url.pathname);
    if (!match?.[1]) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (!checkWsOrigin(req.headers.origin)) {
      reject(socket, 403, 'Forbidden');
      return;
    }
    if (!readSessionFromCookieHeader(req.headers.cookie)) {
      reject(socket, 401, 'Unauthorized');
      return;
    }
    if (!terminalManager.getRow(match[1])) {
      reject(socket, 404, 'Terminal Not Found');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1]);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: import('node:http').IncomingMessage, terminalId: string) => {
    terminalManager.attach(terminalId, ws);

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Pesan bukan JSON valid.' }));
        return;
      }
      const result = terminalClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(JSON.stringify({ type: 'error', message: 'Pesan terminal tidak valid.' }));
        return;
      }
      const message = result.data;
      try {
        if (message.type === 'input') terminalManager.write(terminalId, message.data);
        else if (message.type === 'resize') terminalManager.resize(terminalId, message.cols, message.rows);
        else ws.send(JSON.stringify({ type: 'pong' }));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: (error as Error).message }));
      }
    });

    ws.on('close', () => terminalManager.detach(terminalId, ws));
    ws.on('error', () => terminalManager.detach(terminalId, ws));
  });

  return wss;
}