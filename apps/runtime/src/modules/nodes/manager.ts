import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  AgentInfo,
  NodeHelloParams,
  NodeRpcRequest,
  NodeRpcResponse,
  RemoteNodeCreated,
  RemoteNodeInfo
} from '@dorado/shared';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError } from '../../lib/errors.js';

interface RemoteNodeRow {
  id: string;
  name: string;
  token_hash: string;
  status: 'online' | 'offline';
  hostname: string | null;
  platform: string | null;
  agents_json: string;
  latency_ms: number | null;
  last_seen_at: string | null;
  created_at: string;
}

export function hashNodeToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function generateNodeToken(): string {
  return `dnode_${crypto.randomBytes(24).toString('hex')}`;
}

export function buildPairCommand(token: string): string {
  const wsUrl = `${config.publicBaseUrl.replace(/^http/i, 'ws')}/ws/nodes/connect`;
  return `DORADO_CONTROLLER_URL="${wsUrl}" DORADO_NODE_TOKEN="${token}" npm run node`;
}

function mapNodeRow(row: RemoteNodeRow): RemoteNodeInfo {
  let agents: AgentInfo[] = [];
  try {
    agents = JSON.parse(row.agents_json) as AgentInfo[];
  } catch {
    agents = [];
  }
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    hostname: row.hostname,
    platform: row.platform,
    agents,
    latencyMs: row.latency_ms,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at
  };
}

export class NodeConnection {
  public readonly nodeId: string;
  public readonly ws: WebSocket;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private pingTimer: NodeJS.Timeout | null = null;
  private nextRequestId = 1;
  private terminalClients = new Map<string, Set<WebSocket>>();

  constructor(nodeId: string, ws: WebSocket) {
    this.nodeId = nodeId;
    this.ws = ws;

    this.ws.on('message', (raw) => this.handleMessage(raw));
    this.ws.on('close', () => this.handleClose());
    this.ws.on('error', () => this.handleClose());

    this.startPingLoop();
  }

  public call<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      return Promise.reject(new AppError(503, 'NODE_DISCONNECTED', 'Node remote sedang tidak terhubung.'));
    }
    const id = `ctl_${this.nextRequestId++}_${Date.now()}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(504, 'NODE_TIMEOUT', `Timeout memanggil ${method} pada node remote.`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      });

      const message: NodeRpcRequest = { id, method, params };
      this.ws.send(JSON.stringify(message));
    });
  }

  public async ping(): Promise<number | null> {
    const start = Date.now();
    try {
      await this.call('node.ping', { t: start }, 5_000);
      const latency = Math.max(1, Date.now() - start);
      db.prepare("UPDATE remote_nodes SET latency_ms = ?, last_seen_at = ?, status = 'online' WHERE id = ?").run(
        latency,
        nowIso(),
        this.nodeId
      );
      return latency;
    } catch {
      return null;
    }
  }

  public attachTerminalClient(terminalId: string, clientWs: WebSocket): void {
    let set = this.terminalClients.get(terminalId);
    if (!set) {
      set = new Set();
      this.terminalClients.set(terminalId, set);
      void this.call('terminal.attach', { terminalId }).catch(() => undefined);
    }
    set.add(clientWs);
  }

  public detachTerminalClient(terminalId: string, clientWs: WebSocket): void {
    const set = this.terminalClients.get(terminalId);
    if (set) {
      set.delete(clientWs);
      if (set.size === 0) {
        this.terminalClients.delete(terminalId);
        void this.call('terminal.detach', { terminalId }).catch(() => undefined);
      }
    }
  }

  public broadcastTerminalEvent(terminalId: string, event: unknown): void {
    const set = this.terminalClients.get(terminalId);
    if (set) {
      const payload = typeof event === 'string' ? event : JSON.stringify(event);
      for (const client of set) {
        if (client.readyState === 1 /* WebSocket.OPEN */) {
          client.send(payload);
        }
      }
    }
  }

  public close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const [, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(new AppError(503, 'NODE_DISCONNECTED', 'Koneksi node ditutup.'));
    }
    this.pending.clear();
    for (const [, set] of this.terminalClients) {
      for (const client of set) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'error', message: 'Koneksi ke node remote ditutup.' }));
        }
      }
    }
    this.terminalClients.clear();
    try {
      this.ws.close();
    } catch {
      // abaikan
    }
  }

  private handleClose(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const [, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(new AppError(503, 'NODE_DISCONNECTED', 'Koneksi node terputus.'));
    }
    this.pending.clear();
    for (const [, set] of this.terminalClients) {
      for (const client of set) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: 'error', message: 'Koneksi ke node remote terputus.' }));
        }
      }
    }
    this.terminalClients.clear();
    nodeManager.unregisterConnection(this.nodeId, this);
    db.prepare("UPDATE remote_nodes SET status = 'offline', latency_ms = NULL WHERE id = ?").run(this.nodeId);
  }

  private handleMessage(raw: unknown): void {
    let message: NodeRpcRequest & NodeRpcResponse & { type?: string; terminalId?: string; event?: unknown };
    try {
      message = JSON.parse(String(raw)) as typeof message;
    } catch {
      return;
    }

    // Event streaming terminal dari node ke controller
    if (message.type === 'terminal.event' && message.terminalId && message.event) {
      this.broadcastTerminalEvent(message.terminalId, message.event);
      return;
    }

    // Jika ini adalah respon terhadap request yang kita kirim
    if (message.id && (message.ok !== undefined || message.error !== undefined)) {
      const waiter = this.pending.get(message.id);
      if (waiter) {
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.ok) {
          waiter.resolve(message.data);
        } else {
          waiter.reject(
            new AppError(
              422,
              message.error?.code ?? 'NODE_RPC_ERROR',
              message.error?.message ?? 'Gagal memproses request di node.'
            )
          );
        }
      }
      return;
    }

    // Jika ini adalah request dari Node ke Controller (misalnya handshake node.hello)
    if (message.id && message.method) {
      this.handleIncomingCall(message);
    }
  }

  private handleIncomingCall(req: NodeRpcRequest): void {
    if (req.method === 'node.hello') {
      const params = req.params as NodeHelloParams | undefined;
      const agents = params?.agents ?? [];
      db.prepare(
        `UPDATE remote_nodes
         SET hostname = ?, platform = ?, agents_json = ?, status = 'online', last_seen_at = ?
         WHERE id = ?`
      ).run(params?.hostname ?? null, params?.platform ?? null, JSON.stringify(agents), nowIso(), this.nodeId);
      this.sendResponse(req.id, true, { status: 'registered' });
      void this.ping();
      return;
    }

    this.sendResponse(req.id, false, undefined, {
      code: 'UNKNOWN_METHOD',
      message: `Method ${req.method} tidak dikenal oleh controller.`
    });
  }

  private sendResponse(id: string, ok: boolean, data?: unknown, error?: { code: string; message: string }): void {
    if (this.ws.readyState === 1 /* WebSocket.OPEN */) {
      this.ws.send(JSON.stringify({ id, ok, data, error }));
    }
  }

  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      void this.ping();
    }, 15_000);
    this.pingTimer.unref?.();
  }
}

class NodeManager {
  private connections = new Map<string, NodeConnection>();

  public list(): RemoteNodeInfo[] {
    const rows = db.prepare('SELECT * FROM remote_nodes ORDER BY created_at DESC').all() as unknown as RemoteNodeRow[];
    return rows.map(mapNodeRow);
  }

  public get(id: string): RemoteNodeInfo | null {
    const row = db.prepare('SELECT * FROM remote_nodes WHERE id = ?').get(id) as unknown as RemoteNodeRow | undefined;
    return row ? mapNodeRow(row) : null;
  }

  public getByToken(token: string): { id: string; name: string } | null {
    const hash = hashNodeToken(token);
    const row = db.prepare('SELECT id, name FROM remote_nodes WHERE token_hash = ?').get(hash) as
      | { id: string; name: string }
      | undefined;
    return row ?? null;
  }

  public create(name: string): RemoteNodeCreated {
    const id = newId();
    const token = generateNodeToken();
    const tokenHash = hashNodeToken(token);
    const createdAt = nowIso();

    db.prepare(
      `INSERT INTO remote_nodes (id, name, token_hash, status, agents_json, created_at)
       VALUES (?, ?, ?, 'offline', '[]', ?)`
    ).run(id, name, tokenHash, createdAt);

    const row = db.prepare('SELECT * FROM remote_nodes WHERE id = ?').get(id) as unknown as RemoteNodeRow;
    const baseInfo = mapNodeRow(row);
    return {
      ...baseInfo,
      token,
      pairCommand: buildPairCommand(token)
    };
  }

  public rotateToken(id: string): { token: string; pairCommand: string } | null {
    const existing = db.prepare('SELECT id FROM remote_nodes WHERE id = ?').get(id);
    if (!existing) return null;

    const token = generateNodeToken();
    const tokenHash = hashNodeToken(token);
    db.prepare('UPDATE remote_nodes SET token_hash = ? WHERE id = ?').run(tokenHash, id);

    const conn = this.connections.get(id);
    if (conn) conn.close();

    return { token, pairCommand: buildPairCommand(token) };
  }

  public remove(id: string): boolean {
    const existing = db.prepare('SELECT id FROM remote_nodes WHERE id = ?').get(id);
    if (!existing) return false;

    const conn = this.connections.get(id);
    if (conn) conn.close();

    db.prepare('DELETE FROM remote_nodes WHERE id = ?').run(id);
    return true;
  }

  public registerConnection(nodeId: string, ws: WebSocket): NodeConnection {
    const old = this.connections.get(nodeId);
    if (old) old.close();

    const conn = new NodeConnection(nodeId, ws);
    this.connections.set(nodeId, conn);
    return conn;
  }

  public unregisterConnection(nodeId: string, conn: NodeConnection): void {
    if (this.connections.get(nodeId) === conn) {
      this.connections.delete(nodeId);
    }
  }

  public getConnection(nodeId: string): NodeConnection | null {
    return this.connections.get(nodeId) ?? null;
  }

  public shutdown(): void {
    for (const [, conn] of this.connections) {
      conn.close();
    }
    this.connections.clear();
  }
}

export const nodeManager = new NodeManager();
