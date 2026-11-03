#!/usr/bin/env node
/**
 * Quick tunnel untuk Dorado. Menjalankan cloudflared dan mencetak URL publik.
 * Pemakaian: node scripts/tunnel.mjs [port]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = process.argv[2] ?? process.env.PORT ?? '7788';
const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let found = false;

function handle(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  if (found) return;
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text);
  if (match) {
    found = true;
    fs.writeFileSync('.dorado-tunnel.json', JSON.stringify({ url: match[0], port: Number(port), createdAt: new Date().toISOString() }, null, 2));
    console.log(`\n[dorado] Quick tunnel: ${match[0]}`);
    console.log(`[dorado] Pairing URL akan memakai PUBLIC_BASE_URL. Set PUBLIC_BASE_URL=${match[0]} lalu restart runtime.\n`);
  }
}

child.stdout.on('data', handle);
child.stderr.on('data', handle);

const stop = () => {
  child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));