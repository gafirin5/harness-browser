#!/usr/bin/env node
import { DoradoNodeClient } from './modules/nodes/client.js';

const controllerUrl = process.env.DORADO_CONTROLLER_URL ?? 'ws://127.0.0.1:7788/ws/nodes/connect';
const token = process.env.DORADO_NODE_TOKEN;

if (!token) {
  console.error('[dorado-node] Error: DORADO_NODE_TOKEN wajib diset.');
  console.error(
    'Contoh: DORADO_CONTROLLER_URL=wss://controller/ws/nodes/connect DORADO_NODE_TOKEN=dnode_... npm run node'
  );
  process.exit(1);
}

console.log(`[dorado-node] Menghubungkan ke ${controllerUrl}...`);

const client = new DoradoNodeClient({
  controllerUrl,
  token,
  autoReconnect: true,
  onConnect: () => {
    console.log('[dorado-node] Berhasil terhubung ke controller.');
  },
  onDisconnect: () => {
    console.log('[dorado-node] Terputus dari controller. Menunggu koneksi ulang...');
  },
  onError: (err) => {
    console.error('[dorado-node] Error koneksi:', err.message);
  }
});

client.connect();

process.on('SIGINT', () => {
  console.log('[dorado-node] Menghentikan node...');
  client.disconnect();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[dorado-node] Menghentikan node...');
  client.disconnect();
  process.exit(0);
});
