import { spawn, type ChildProcess } from 'node:child_process';
import type { SshTunnelInfo } from '@dorado/shared';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';

interface TunnelRow {
  id: string;
  project_id: string;
  name: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  local_port: number;
  remote_port: number;
  status: string;
  created_at: string;
}

export interface SshTunnelInput {
  projectId: string;
  name: string;
  host: string;
  port: number;
  user: string;
  localPort: number;
  remotePort: number;
}

const running = new Map<string, ChildProcess>();

function getRow(id: string): TunnelRow | null {
  return (db.prepare('SELECT * FROM ssh_tunnels WHERE id = ?').get(id) as unknown as TunnelRow | undefined) ?? null;
}

function mapTunnel(row: TunnelRow): SshTunnelInfo {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    host: row.ssh_host,
    port: row.ssh_port,
    user: row.ssh_user,
    localPort: row.local_port,
    remotePort: row.remote_port,
    status: running.has(row.id) ? 'running' : 'stopped',
    createdAt: row.created_at
  };
}

export function listTunnels(): SshTunnelInfo[] {
  const rows = db.prepare('SELECT * FROM ssh_tunnels ORDER BY created_at DESC').all() as unknown as TunnelRow[];
  return rows.map(mapTunnel);
}

export function getTunnel(id: string): SshTunnelInfo | null {
  const row = getRow(id);
  return row ? mapTunnel(row) : null;
}

function validatePort(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppError(422, 'INVALID_PORT', `${label} harus 1–65535.`);
  }
}

export function createTunnel(input: SshTunnelInput): SshTunnelInfo {
  if (!input.host.trim() || !input.user.trim()) {
    throw new AppError(422, 'INVALID_SSH', 'Host dan user SSH wajib diisi.');
  }
  validatePort(input.port, 'Port SSH');
  validatePort(input.localPort, 'Port lokal');
  validatePort(input.remotePort, 'Port remote');

  const id = newId();
  db.prepare(
    `INSERT INTO ssh_tunnels (id, project_id, name, ssh_host, ssh_port, ssh_user, local_port, remote_port, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?)`
  ).run(
    id,
    input.projectId,
    input.name.slice(0, 80),
    input.host,
    input.port,
    input.user,
    input.localPort,
    input.remotePort,
    nowIso()
  );
  startTunnel(id);
  return getTunnel(id) as SshTunnelInfo;
}

export function startTunnel(id: string): void {
  const row = getRow(id);
  if (!row) throw notFound('Tunnel tidak ditemukan.');
  if (running.has(id)) return;
  const child = spawn(
    'ssh',
    [
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-L',
      `127.0.0.1:${row.local_port}:127.0.0.1:${row.remote_port}`,
      '-p',
      String(row.ssh_port),
      `${row.ssh_user}@${row.ssh_host}`
    ],
    { stdio: 'ignore' }
  );
  running.set(id, child);
  const clear = (): void => {
    running.delete(id);
    db.prepare("UPDATE ssh_tunnels SET status = 'stopped' WHERE id = ?").run(id);
  };
  child.on('exit', clear);
  child.on('error', clear);
}

export function stopTunnel(id: string): void {
  const child = running.get(id);
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      // abaikan
    }
    running.delete(id);
  }
  db.prepare("UPDATE ssh_tunnels SET status = 'stopped' WHERE id = ?").run(id);
}

export function removeTunnel(id: string): boolean {
  stopTunnel(id);
  return Number(db.prepare('DELETE FROM ssh_tunnels WHERE id = ?').run(id).changes) > 0;
}

/** Port lokal dari tunnel yang sedang berjalan untuk sebuah project. */
export function localPortsForProject(projectId: string): number[] {
  const rows = db.prepare('SELECT * FROM ssh_tunnels WHERE project_id = ?').all(projectId) as unknown as TunnelRow[];
  return rows.filter((row) => running.has(row.id)).map((row) => row.local_port);
}

export function sshTunnelShutdown(): void {
  for (const [, child] of running) {
    try {
      child.kill('SIGTERM');
    } catch {
      // abaikan
    }
  }
  running.clear();
}
