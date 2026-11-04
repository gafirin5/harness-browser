#!/usr/bin/env node
/**
 * Mock worker agent untuk pengembangan Orchestrator Dorado.
 * Jalankan: AGENT_TOKEN=orca_agt_... PORT=9101 node scripts/mock-orchestrator-agent.mjs
 */
import http from 'node:http';

const port = Number(process.env.PORT ?? 9101);
const token = process.env.AGENT_TOKEN ?? '';
const delayMs = Number(process.env.MOCK_DELAY_MS ?? 1200);

if (!token) {
  console.error('AGENT_TOKEN wajib diisi.');
  process.exit(1);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${token}`) {
    send(res, 401, { error: 'token tidak valid' });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { status: 'ok', agent: 'mock', uptime: process.uptime() });
    return;
  }

  if (req.method === 'POST' && req.url === '/tasks') {
    const payload = await readJson(req);
    const code = payload.task?.code;
    console.log(`[mock-agent] menerima ${code} (${payload.task?.title})`);
    send(res, 202, { accepted: true, worker_task_id: `mock-${code}` });

    setTimeout(() => {
      const url = payload.callback?.url;
      if (!url) return;
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          status: 'COMPLETED',
          tokenUsed: 2500,
          result: `Mock output untuk ${code}`
        })
      })
        .then(async (response) => {
          console.log(`[mock-agent] callback ${code} -> HTTP ${response.status} ${await response.text()}`);
        })
        .catch((error) => console.error('[mock-agent] callback gagal:', error.message));
    }, delayMs).unref();
    return;
  }

  if (req.method === 'POST' && /^\/tasks\/[^/]+\/cancel$/.test(req.url ?? '')) {
    const code = req.url.split('/')[2];
    console.log(`[mock-agent] menerima pembatalan ${code}`);
    send(res, 200, { cancelled: true });
    return;
  }

  send(res, 404, { error: 'tidak ditemukan' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-agent] listening on http://127.0.0.1:${port}`);
});
