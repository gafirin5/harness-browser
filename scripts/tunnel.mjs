#!/usr/bin/env node
/**
 * Tunnel Dorado.
 *
 *   node scripts/tunnel.mjs [quick] [port]   → quick tunnel Cloudflare (*.trycloudflare.com)
 *   node scripts/tunnel.mjs named            → named tunnel (URL tetap)
 *        env: DORADO_TUNNEL_TOKEN=...  (cloudflared tunnel run --token) ATAU
 *             DORADO_TUNNEL_NAME=dorado (cloudflared tunnel run <name>)
 *   node scripts/tunnel.mjs setup <hostname> → sekali saja: create + route dns + config.yml
 *
 * Quick tunnel berubah URL tiap restart. Named tunnel permanen (butuh domain Cloudflare).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2] ?? 'quick';
const port = process.env.PORT ?? '7788';
const cloudflaredDir = path.join(os.homedir(), '.cloudflared');

function run(args, opts = {}) {
  return execFileSync('cloudflared', args, { stdio: 'inherit', ...opts });
}

function runCapture(args) {
  return execFileSync('cloudflared', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function listTunnels() {
  try {
    return JSON.parse(runCapture(['tunnel', 'list', '--output', 'json']));
  } catch {
    return [];
  }
}

function quickTunnel() {
  const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let found = false;
  const handle = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (found) return;
    const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
    if (match) {
      found = true;
      fs.writeFileSync(
        '.dorado-tunnel.json',
        JSON.stringify({ url: match[0], port: Number(port), createdAt: new Date().toISOString() }, null, 2)
      );
      console.log(`\n[dorado] Quick tunnel: ${match[0]}`);
      console.log(`[dorado] Set PUBLIC_BASE_URL=${match[0]} lalu restart runtime.\n`);
    }
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  const stop = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

function namedTunnel() {
  if (process.env.DORADO_TUNNEL_TOKEN) {
    console.log('[dorado] Named tunnel via token.');
    run(['tunnel', 'run', '--token', process.env.DORADO_TUNNEL_TOKEN]);
    return;
  }
  const name = process.env.DORADO_TUNNEL_NAME ?? 'dorado';
  console.log(`[dorado] Named tunnel: ${name}`);
  run(['tunnel', 'run', name]);
}

function setupTunnel(hostname) {
  if (!hostname) {
    console.error('Pemakaian: node scripts/tunnel.mjs setup <hostname>');
    process.exit(1);
  }
  if (!fs.existsSync(path.join(cloudflaredDir, 'cert.pem'))) {
    console.error('[dorado] Belum login Cloudflare. Jalankan dulu:');
    console.error('  cloudflared tunnel login');
    process.exit(1);
  }

  let tunnel = listTunnels().find((item) => item.name === 'dorado');
  if (!tunnel) {
    console.log('[dorado] Membuat tunnel "dorado"...');
    run(['tunnel', 'create', 'dorado']);
    tunnel = listTunnels().find((item) => item.name === 'dorado');
  }
  if (!tunnel) {
    console.error('[dorado] Gagal menemukan tunnel "dorado" setelah dibuat.');
    process.exit(1);
  }

  console.log(`[dorado] Routing DNS ${hostname} → tunnel dorado...`);
  try {
    run(['tunnel', 'route', 'dns', 'dorado', hostname]);
  } catch {
    console.log('[dorado] (DNS mungkin sudah ada, lanjut.)');
  }

  const credentialsFile = path.join(cloudflaredDir, `${tunnel.id}.json`);
  const config = [
    `tunnel: dorado`,
    `credentials-file: ${credentialsFile}`,
    `ingress:`,
    `  - hostname: ${hostname}`,
    `    service: http://127.0.0.1:${port}`,
    `  - service: http_status:404`,
    ``
  ].join('\n');
  fs.writeFileSync(path.join(cloudflaredDir, 'config.yml'), config);

  console.log('\n[dorado] Named tunnel siap. Langkah selanjutnya:');
  console.log(`  1. Jalankan tunnel: cloudflared tunnel run dorado   (atau: npm run tunnel:named)`);
  console.log(`  2. Set di .env runtime: PUBLIC_BASE_URL=https://${hostname}`);
  console.log(`  3. Restart runtime. URL ini permanen.\n`);
}

if (mode === 'named') {
  namedTunnel();
} else if (mode === 'setup') {
  setupTunnel(process.argv[3]);
} else {
  quickTunnel();
}
