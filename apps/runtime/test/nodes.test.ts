import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DoradoNodeClient } from '../src/modules/nodes/client.js';
import { nodeManager } from '../src/modules/nodes/manager.js';
import { setupTerminalWebSocket } from '../src/ws.js';

describe('remote nodes federation', () => {
  let server: http.Server;
  let port: number;
  let adminAgent: ReturnType<typeof request.agent>;
  let viewerAgent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    setupTerminalWebSocket(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;

    adminAgent = request.agent(server);
    await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'test-password' });

    // Buat viewer user
    await adminAgent.post('/api/users').send({
      username: 'node-viewer',
      name: 'Node Viewer',
      password: 'viewer-password-123',
      role: 'VIEWER'
    });
    viewerAgent = request.agent(server);
    await viewerAgent.post('/api/auth/login').send({ username: 'node-viewer', password: 'viewer-password-123' });
  });

  afterAll(async () => {
    nodeManager.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('CRUD node via API dan hak akses role', async () => {
    // Viewer ditolak membuat node
    const viewerCreate = await viewerAgent.post('/api/nodes').send({ name: 'Node Viewer Try' });
    expect(viewerCreate.status).toBe(403);

    // Admin berhasil membuat node
    const createRes = await adminAgent.post('/api/nodes').send({ name: 'GPU Cluster 1' });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe('GPU Cluster 1');
    expect(createRes.body.data.status).toBe('offline');
    expect(createRes.body.data.token).toMatch(/^dnode_[a-f0-9]{48}$/);
    expect(createRes.body.data.pairCommand).toContain(createRes.body.data.token);
    const nodeId = createRes.body.data.id;
    const initialToken = createRes.body.data.token;

    // List nodes dapat dibaca baik oleh Admin maupun Viewer
    const listAdmin = await adminAgent.get('/api/nodes');
    expect(listAdmin.status).toBe(200);
    expect(listAdmin.body.data.some((n: { id: string }) => n.id === nodeId)).toBe(true);

    const listViewer = await viewerAgent.get('/api/nodes');
    expect(listViewer.status).toBe(200);
    expect(listViewer.body.data.some((n: { id: string }) => n.id === nodeId)).toBe(true);

    // Rotate token
    const rotateRes = await adminAgent.post(`/api/nodes/${nodeId}/token`);
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.data.token).toMatch(/^dnode_[a-f0-9]{48}$/);
    expect(rotateRes.body.data.token).not.toBe(initialToken);

    // Delete node
    const deleteRes = await adminAgent.delete(`/api/nodes/${nodeId}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await adminAgent.get('/api/nodes');
    expect(afterDelete.body.data.some((n: { id: string }) => n.id === nodeId)).toBe(false);
  });

  it('koneksi reverse WSS dari node client, handshake node.hello, ping latency, dan disconnect', async () => {
    // 1. Buat node di controller
    const created = nodeManager.create('Remote Worker Linux');
    const controllerUrl = `ws://127.0.0.1:${port}/ws/nodes/connect`;

    // 2. Coba koneksi dengan token salah -> harus ditolak
    const badClient = new DoradoNodeClient({
      controllerUrl,
      token: 'dnode_token_palsu_123',
      autoReconnect: false
    });
    const badErrorPromise = new Promise<Error>((resolve) => {
      badClient['options'].onError = resolve;
    });
    badClient.connect();
    await badErrorPromise;
    badClient.disconnect();

    // 3. Hubungkan dengan token valid
    let connected = false;
    const client = new DoradoNodeClient({
      controllerUrl,
      token: created.token,
      autoReconnect: false,
      onConnect: () => {
        connected = true;
      }
    });

    client.connect();

    // Tunggu hingga terhubung dan handshake node.hello selesai
    for (let i = 0; i < 40; i += 1) {
      const row = nodeManager.get(created.id);
      if (connected && row?.status === 'online' && row.hostname) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const onlineNode = nodeManager.get(created.id);
    expect(onlineNode?.status).toBe('online');
    expect(onlineNode?.hostname).toBeTruthy();
    expect(onlineNode?.platform).toBeTruthy();
    expect(Array.isArray(onlineNode?.agents)).toBe(true);

    // 4. Test Controller memanggil ping ke Node
    const activeConn = nodeManager.getConnection(created.id);
    expect(activeConn).toBeTruthy();
    const latency = await activeConn?.ping();
    expect(typeof latency).toBe('number');
    expect(latency).toBeGreaterThan(0);

    const pingedNode = nodeManager.get(created.id);
    expect(pingedNode?.latencyMs).toBe(latency);
    expect(pingedNode?.status).toBe('online');

    // 5. Node disconnect -> status kembali offline
    client.disconnect();

    for (let i = 0; i < 30; i += 1) {
      const row = nodeManager.get(created.id);
      if (row?.status === 'offline') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const offlineNode = nodeManager.get(created.id);
    expect(offlineNode?.status).toBe('offline');
    expect(offlineNode?.latencyMs).toBeNull();

    // Cleanup
    nodeManager.remove(created.id);
  });
});
