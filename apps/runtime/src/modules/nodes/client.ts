import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import type { ControllerIdentity, NodeHelloParams, NodeHelloResponse, NodeRpcRequest } from '@dorado/shared';
import { listAgents } from '../sessions/agents.js';
import { createNodeRpcHandlers } from './rpc-handlers.js';

export interface NodeClientOptions {
  controllerUrl: string;
  token: string;
  autoReconnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
  onController?: (controller: ControllerIdentity) => void;
}

export type NodeRpcHandler = (params: unknown) => Promise<unknown> | unknown;

interface NodeStateFile {
  controllerUrl: string;
  connected: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  controller: ControllerIdentity | null;
}

/** Lokasi state file node (dipakai juga oleh `npm run node:status`). */
export function nodeStateFilePath(): string {
  return process.env.DORADO_NODE_STATE_FILE ?? path.join(os.homedir(), '.dorado-node', 'state.json');
}

export class DoradoNodeClient {
  private ws: WebSocket | null = null;
  private closedExplicitly = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private handlers = new Map<string, NodeRpcHandler>();
  private controller: ControllerIdentity | null = null;
  private connectedAt: string | null = null;
  private helloId: string | null = null;

  constructor(private options: NodeClientOptions) {
    this.registerBuiltinHandlers();
    const rpcHandlers = createNodeRpcHandlers(this);
    for (const [method, handler] of Object.entries(rpcHandlers)) {
      this.registerHandler(method, handler);
    }
  }

  public registerHandler(method: string, handler: NodeRpcHandler): void {
    this.handlers.set(method, handler);
  }

  public getController(): ControllerIdentity | null {
    return this.controller;
  }

  public connect(): void {
    this.closedExplicitly = false;
    this.clearReconnect();

    const headers = {
      'x-dorado-node-token': this.options.token
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.controllerUrl, { headers });
    } catch (err) {
      this.handleError(err as Error);
      this.scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.on('open', () => {
      this.retryCount = 0;
      this.connectedAt = new Date().toISOString();
      this.sendHello();
      this.writeState(true);
      this.options.onConnect?.();
    });

    socket.on('message', async (raw) => {
      let message: NodeRpcRequest & { ok?: boolean; data?: NodeHelloResponse };
      try {
        message = JSON.parse(String(raw)) as typeof message;
      } catch {
        return;
      }
      if (this.helloId && message.id === this.helloId && message.data?.controller) {
        this.controller = message.data.controller;
        this.options.onController?.(message.data.controller);
        this.writeState(true);
        return;
      }
      if (!message.id || !message.method) return;
      await this.handleRequest(message);
    });

    socket.on('close', () => {
      this.ws = null;
      this.writeState(false);
      this.options.onDisconnect?.();
      if (!this.closedExplicitly && this.options.autoReconnect !== false) {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (err) => {
      this.handleError(err);
      try {
        socket.close();
      } catch {
        // abaikan
      }
    });
  }

  public disconnect(): void {
    this.closedExplicitly = true;
    this.clearReconnect();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // abaikan
      }
      this.ws = null;
    }
    this.writeState(false);
  }

  public isConnected(): boolean {
    return this.ws?.readyState === 1 /* WebSocket.OPEN */;
  }

  private sendHello(): void {
    const params: NodeHelloParams = {
      hostname: os.hostname(),
      platform: `${os.platform()} (${os.arch()})`,
      version: '0.1.0',
      agents: listAgents()
    };
    this.helloId = `hello_${Date.now()}`;
    this.send({ id: this.helloId, method: 'node.hello', params });
  }

  private registerBuiltinHandlers(): void {
    this.registerHandler('node.ping', () => ({ pong: true }));
  }

  private async handleRequest(req: NodeRpcRequest): Promise<void> {
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.sendResponse(req.id, false, undefined, {
        code: 'METHOD_NOT_FOUND',
        message: `Method ${req.method} tidak didukung oleh node.`
      });
      return;
    }

    try {
      const data = await handler(req.params);
      this.sendResponse(req.id, true, data);
    } catch (caught) {
      const err = caught as { code?: string; message?: string };
      this.sendResponse(req.id, false, undefined, {
        code: err.code ?? 'HANDLER_ERROR',
        message: err.message ?? 'Gagal memproses aksi di node remote.'
      });
    }
  }

  private sendResponse(id: string, ok: boolean, data?: unknown, error?: { code: string; message: string }): void {
    this.send({ id, ok, data, error });
  }

  public send(msg: unknown): void {
    if (this.ws?.readyState === 1 /* WebSocket.OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleError(err: Error): void {
    this.options.onError?.(err);
  }

  private writeState(connected: boolean): void {
    const payload: NodeStateFile = {
      controllerUrl: this.options.controllerUrl,
      connected,
      connectedAt: this.connectedAt,
      disconnectedAt: connected ? null : new Date().toISOString(),
      controller: this.controller
    };
    const file = nodeStateFilePath();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    } catch {
      // abaikan kegagalan menulis state (mis. path read-only)
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 15000);
    this.retryCount += 1;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
