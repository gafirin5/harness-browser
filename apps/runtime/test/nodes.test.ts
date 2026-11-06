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
  let adminCookie = '';

  beforeAll(async () => {
    const app = createApp();
    server = http.createServer(app);
    setupTerminalWebSocket(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    port = (server.address() as AddressInfo).port;

    adminAgent = request.agent(server);
    const loginRes = await adminAgent.post('/api/auth/login').send({ username: 'admin', password: 'test-password' });
    expect(loginRes.status).toBe(200);
    adminCookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0] ?? '';

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

  it('relay RPC untuk remote projects, worktrees, dan checkpoint via header x-dorado-node-id', async () => {
    // 1. Buat node dan hubungkan client
    const created = nodeManager.create('Remote Worker Proj');
    const controllerUrl = `ws://127.0.0.1:${port}/ws/nodes/connect`;

    // Saat node masih offline, request dengan x-dorado-node-id harus gagal 503
    const offlineReq = await adminAgent.get('/api/projects').set('x-dorado-node-id', created.id);
    expect(offlineReq.status).toBe(503);
    expect(offlineReq.body.error.code).toBe('NODE_DISCONNECTED');

    // Hubungkan client
    const client = new DoradoNodeClient({
      controllerUrl,
      token: created.token,
      autoReconnect: false
    });

    // Pasang custom handler mock untuk proyek & worktree di node
    const mockProjects = [
      { id: 'p_remote_1', name: 'Remote Project A', path: '/remote/repo', createdAt: '2026-11-06T00:00:00.000Z' }
    ];
    const mockWorktrees = [
      {
        id: 'wt_remote_1',
        projectId: 'p_remote_1',
        branch: 'agent/remote-feature',
        path: '/remote/worktrees/feat',
        baseRef: 'main',
        status: 'ready',
        taskStatus: 'todo',
        note: 'Menunggu dikerjakan',
        createdAt: '2026-11-06T00:00:00.000Z'
      }
    ];

    client.registerHandler('projects.list', () => mockProjects);
    client.registerHandler('worktrees.list', (params) => {
      const p = params as { projectId?: string };
      return mockWorktrees.filter((w) => !p?.projectId || w.projectId === p.projectId);
    });
    client.registerHandler('worktrees.update', (params) => {
      const p = params as { id: string; taskStatus?: string; note?: string };
      const wt = mockWorktrees.find((w) => w.id === p.id);
      if (!wt) throw new Error('Worktree tidak ditemukan');
      if (p.taskStatus) wt.taskStatus = p.taskStatus;
      if (p.note !== undefined) wt.note = p.note;
      return wt;
    });

    client.connect();

    // Tunggu koneksi established
    for (let i = 0; i < 30; i += 1) {
      if (nodeManager.get(created.id)?.status === 'online') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // 2. Panggil GET /api/projects dengan header node
    const remoteProjects = await adminAgent.get('/api/projects').set('x-dorado-node-id', created.id);
    expect(remoteProjects.status).toBe(200);
    expect(remoteProjects.body.data).toEqual(mockProjects);

    // 3. Panggil GET /api/worktrees dengan header node
    const remoteWorktrees = await adminAgent
      .get('/api/worktrees?projectId=p_remote_1')
      .set('x-dorado-node-id', created.id);
    expect(remoteWorktrees.status).toBe(200);
    expect(remoteWorktrees.body.data).toHaveLength(1);
    expect(remoteWorktrees.body.data[0].branch).toBe('agent/remote-feature');
    expect(remoteWorktrees.body.data[0].taskStatus).toBe('todo');

    // 4. Update checkpoint worktree remote (PATCH /api/worktrees/:id)
    const updateCheckpoint = await adminAgent
      .patch('/api/worktrees/wt_remote_1')
      .set('x-dorado-node-id', created.id)
      .send({ taskStatus: 'in-progress', note: 'Sedang dikerjakan remote' });
    expect(updateCheckpoint.status).toBe(200);
    expect(updateCheckpoint.body.data.taskStatus).toBe('in-progress');
    expect(updateCheckpoint.body.data.note).toBe('Sedang dikerjakan remote');

    // 5. Test universal HTTP relay untuk endpoint lain (misalnya /api/agents)
    client.registerHandler('http.request', () => {
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { data: [{ id: 'remote_agent_opencode', name: 'Remote OpenCode', installed: true }] }
      };
    });
    const remoteAgents = await adminAgent.get('/api/agents').set('x-dorado-node-id', created.id);
    expect(remoteAgents.status).toBe(200);
    expect(remoteAgents.body.data[0].id).toBe('remote_agent_opencode');

    client.disconnect();
    nodeManager.remove(created.id);
  });

  it('streaming WebSocket terminal remote (input, output relay, detach)', async () => {
    const created = nodeManager.create('Remote Worker Term');
    const controllerUrl = `ws://127.0.0.1:${port}/ws/nodes/connect`;

    const client = new DoradoNodeClient({
      controllerUrl,
      token: created.token,
      autoReconnect: false
    });

    let receivedInput = '';
    let attachedTerminal = '';
    let detachedTerminal = '';

    client.registerHandler('terminal.attach', (params) => {
      const p = params as { terminalId: string };
      attachedTerminal = p.terminalId;
      // Simulasikan terminal mengirim replay buffer begitu di-attach
      setTimeout(() => {
        client.send({
          type: 'terminal.event',
          terminalId: p.terminalId,
          event: { type: 'replay', data: 'welcome to remote tmux\r\n' }
        });
      }, 20);
      return { ok: true };
    });

    client.registerHandler('terminal.detach', (params) => {
      const p = params as { terminalId: string };
      detachedTerminal = p.terminalId;
      return { ok: true };
    });

    client.registerHandler('terminals.input', (params) => {
      const p = params as { id: string; data: string };
      receivedInput = p.data;
      // Echo output balik ke client browser
      client.send({
        type: 'terminal.event',
        terminalId: p.id,
        event: { type: 'output', data: `echoed: ${p.data}` }
      });
      return { ok: true };
    });

    client.connect();

    for (let i = 0; i < 30; i += 1) {
      if (nodeManager.get(created.id)?.status === 'online') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Browser menghubungkan WebSocket ke Controller dengan query nodeId
    const { WebSocket: ClientWs } = await import('ws');
    const browserWs = new ClientWs(`ws://127.0.0.1:${port}/ws/terminals/term_remote_101?nodeId=${created.id}`, {
      headers: {
        cookie: adminCookie,
        origin: `http://127.0.0.1:7788`
      }
    });

    const receivedMessages: Array<{ type: string; data?: string }> = [];
    browserWs.on('message', (raw) => {
      try {
        receivedMessages.push(JSON.parse(String(raw)));
      } catch {
        // ignore
      }
    });

    await new Promise<void>((resolve, reject) => {
      browserWs.on('open', () => resolve());
      browserWs.on('error', (err) => reject(err));
    });

    // 1. Verifikasi node menerima terminal.attach
    for (let i = 0; i < 30; i += 1) {
      if (attachedTerminal === 'term_remote_101' && receivedMessages.some((m) => m.type === 'replay')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(attachedTerminal).toBe('term_remote_101');
    expect(receivedMessages.some((m) => m.type === 'replay' && m.data?.includes('welcome to remote tmux'))).toBe(true);

    // 2. Browser mengirim input terminal
    browserWs.send(JSON.stringify({ type: 'input', data: 'ls -la\r' }));

    for (let i = 0; i < 30; i += 1) {
      if (receivedInput.includes('ls -la') && receivedMessages.some((m) => m.data?.includes('echoed: ls -la'))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(receivedInput).toBe('ls -la\r');
    expect(receivedMessages.some((m) => m.type === 'output' && m.data?.includes('echoed: ls -la'))).toBe(true);

    // 3. Browser disconnect -> Controller mengirim terminal.detach ke Node
    browserWs.close();

    for (let i = 0; i < 30; i += 1) {
      if (detachedTerminal === 'term_remote_101') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(detachedTerminal).toBe('term_remote_101');

    client.disconnect();
    nodeManager.remove(created.id);
  });
});
