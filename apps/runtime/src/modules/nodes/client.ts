import os from 'node:os';
import { WebSocket } from 'ws';
import type { NodeHelloParams, NodeRpcRequest, NodeRpcResponse } from '@dorado/shared';
import { listAgents } from '../sessions/agents.js';

export interface NodeClientOptions {
  controllerUrl: string;
  token: string;
  autoReconnect?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error) => void;
}

export type NodeRpcHandler = (params: unknown) => Promise<unknown> | unknown;

export class DoradoNodeClient {
  private ws: WebSocket | null = null;
  private closedExplicitly = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private handlers = new Map<string, NodeRpcHandler>();

  constructor(private options: NodeClientOptions) {
    this.registerBuiltinHandlers();
  }

  public registerHandler(method: string, handler: NodeRpcHandler): void {
    this.handlers.set(method, handler);
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
      this.sendHello();
      this.options.onConnect?.();
    });

    socket.on('message', async (raw) => {
      let req: NodeRpcRequest;
      try {
        req = JSON.parse(String(raw)) as NodeRpcRequest;
      } catch {
        return;
      }
      if (!req.id || !req.method) return;
      await this.handleRequest(req);
    });

    socket.on('close', () => {
      this.ws = null;
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
    this.send({ id: `hello_${Date.now()}`, method: 'node.hello', params });
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

  private send(msg: NodeRpcRequest | NodeRpcResponse): void {
    if (this.ws?.readyState === 1 /* WebSocket.OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleError(err: Error): void {
    this.options.onError?.(err);
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
