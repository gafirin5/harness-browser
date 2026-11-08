#!/usr/bin/env node
/**
 * Tampilkan status node Dorado: controller apa yang mengendalikannya.
 * Membaca state file yang ditulis oleh `npm run node`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = process.env.DORADO_NODE_STATE_FILE ?? path.join(os.homedir(), '.dorado-node', 'state.json');

if (!fs.existsSync(file)) {
  console.log('Belum ada state node. Jalankan `npm run node` terlebih dahulu.');
  console.log(`(state file: ${file})`);
  process.exit(0);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Gagal membaca state file (${file}): ${error.message}`);
  process.exit(1);
}

const controller = state.controller;
console.log('Dorado Node Status');
console.log(`State file : ${file}`);
console.log(`Endpoint   : ${state.controllerUrl ?? '(tidak diketahui)'}`);
console.log(`Status     : ${state.connected ? 'connected' : 'disconnected'}`);
if (state.connectedAt) console.log(`Sejak      : ${state.connectedAt}`);
if (!state.connected && state.disconnectedAt) console.log(`Terputus   : ${state.disconnectedAt}`);
if (controller) {
  console.log('Controller :');
  console.log(`  Nama     : ${controller.name}`);
  console.log(`  URL      : ${controller.url}`);
  console.log(`  Versi    : ${controller.version}`);
  console.log(`  Instance : ${controller.id}`);
  console.log(`  Host     : ${controller.hostname}`);
} else {
  console.log('Controller : (belum menerima identitas — pastikan controller versi terbaru)');
}
