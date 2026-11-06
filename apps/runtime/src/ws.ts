import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { terminalClientMessageSchema } from '@dorado/shared';
import { terminalManager } from './modules/terminals/manager.js';
import { nodeManager } from './modules/nodes/manager.js';
import { checkWsOrigin } from './modules/auth/middleware.js';
import { getSessionFromCookieHeader } from './modules/auth/session.js';

function reject(socket: import('node:stream').Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function setupTerminalWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const nodesWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/ws/nodes/connect') {
      const authHeader = req.headers.authorization;
      const customHeader = req.headers['x-dorado-node-token'];
      const queryToken = url.searchParams.get('token');
      const rawToken = (
        typeof customHeader === 'string'
          ? customHeader
          : typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7)
            : queryToken
      )?.trim();

      if (!rawToken) {
        reject(socket, 401, 'Unauthorized');
        return;
      }
      const node = nodeManager.getByToken(rawToken);
      if (!node) {
        reject(socket, 401, 'Unauthorized');
        return;
      }

      nodesWss.handleUpgrade(req, socket, head, (ws) => {
        nodeManager.registerConnection(node.id, ws);
      });
      return;
    }

    const match = /^\/ws\/terminals\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (!match?.[1]) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if (!checkWsOrigin(req.headers.origin)) {
      reject(socket, 403, 'Forbidden');
      return;
    }
    const session = getSessionFromCookieHeader(req.headers.cookie);
    if (!session) {
      reject(socket, 401, 'Unauthorized');
      return;
    }

    const remoteNodeId = url.searchParams.get('nodeId');
    if (remoteNodeId) {
      const nodeConn = nodeManager.getConnection(remoteNodeId);
      if (!nodeConn) {
        reject(socket, 503, 'Node Offline');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('remote_terminal_connection', ws, req, remoteNodeId, match[1], session.user.role);
      });
      return;
    }

    if (!terminalManager.getRow(match[1])) {
      reject(socket, 404, 'Terminal Not Found');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, match[1], session.user.role);
    });
  });

  wss.on(
    'remote_terminal_connection',
    (
      ws: WebSocket,
      _req: import('node:http').IncomingMessage,
      remoteNodeId: string,
      terminalId: string,
      role: 'ADMIN' | 'VIEWER'
    ) => {
      const readOnly = role !== 'ADMIN';
      const nodeConn = nodeManager.getConnection(remoteNodeId);
      if (!nodeConn) {
        ws.send(JSON.stringify({ type: 'error', message: 'Node remote tidak terhubung.' }));
        ws.close();
        return;
      }

      nodeConn.attachTerminalClient(terminalId, ws);

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
        if (message.type === 'input') {
          if (readOnly) {
            ws.send(JSON.stringify({ type: 'error', message: 'Mode viewer: input terminal dinonaktifkan.' }));
            return;
          }
          void nodeConn.call('terminals.input', { id: terminalId, data: message.data }).catch(() => undefined);
        } else if (message.type === 'resize') {
          if (!readOnly) {
            void nodeConn
              .call('terminals.resize', { id: terminalId, cols: message.cols, rows: message.rows })
              .catch(() => undefined);
          }
        } else {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      });

      ws.on('close', () => nodeConn.detachTerminalClient(terminalId, ws));
      ws.on('error', () => nodeConn.detachTerminalClient(terminalId, ws));
    }
  );

  wss.on(
    'connection',
    (ws: WebSocket, _req: import('node:http').IncomingMessage, terminalId: string, role: 'ADMIN' | 'VIEWER') => {
      const readOnly = role !== 'ADMIN';
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
          if (message.type === 'input') {
            if (readOnly) {
              ws.send(JSON.stringify({ type: 'error', message: 'Mode viewer: input terminal dinonaktifkan.' }));
              return;
            }
            terminalManager.write(terminalId, message.data);
          } else if (message.type === 'resize') {
            if (!readOnly) terminalManager.resize(terminalId, message.cols, message.rows);
          } else {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', message: (error as Error).message }));
        }
      });

      ws.on('close', () => terminalManager.detach(terminalId, ws));
      ws.on('error', () => terminalManager.detach(terminalId, ws));
    }
  );

  return wss;
}
