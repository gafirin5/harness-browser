import fs from 'node:fs';
import path from 'node:path';
import type { TerminalInfo, TerminalKind, TerminalStatus } from '@dorado/shared';
import type { IPty } from 'node-pty';
import * as pty from 'node-pty';
import type { WebSocket } from 'ws';
import { config } from '../../config.js';
import { db, newId, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import { getWorktreeRow } from '../worktrees/routes.js';

const MAX_BUFFER = 2 * 1024 * 1024;

interface Runtime {
  id: string;
  pty: IPty | null;
  chunks: string[];
  bufferSize: number;
  clients: Set<WebSocket>;
  log: fs.WriteStream | null;
  stopping: boolean;
  exitCode: number | null;
}

interface TerminalRow {
  id: string;
  worktree_id: string;
  title: string;
  kind: TerminalKind;
  status: TerminalStatus;
  cols: number;
  rows: number;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
}

export type TerminalExitListener = (terminalId: string, code: number, stopped: boolean) => void;

function mapTerminal(row: TerminalRow): TerminalInfo {
  return {
    id: row.id,
    worktreeId: row.worktree_id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    cols: row.cols,
    rows: row.rows,
    exitCode: row.exit_code,
    createdAt: row.created_at
  };
}

class TerminalManager {
  private runtimes = new Map<string, Runtime>();
  private exitListeners = new Set<TerminalExitListener>();

  onExit(listener: TerminalExitListener): void {
    this.exitListeners.add(listener);
  }

  getRow(id: string): TerminalRow | null {
    return (db.prepare('SELECT * FROM terminals WHERE id = ?').get(id) as unknown as TerminalRow | undefined) ?? null;
  }

  list(worktreeId?: string): TerminalInfo[] {
    const rows = (
      worktreeId
        ? db.prepare('SELECT * FROM terminals WHERE worktree_id = ? ORDER BY created_at ASC').all(worktreeId)
        : db.prepare('SELECT * FROM terminals ORDER BY created_at ASC').all()
    ) as unknown as unknown as TerminalRow[];
    return rows.map(mapTerminal);
  }

  create(options: {
    worktreeId: string;
    title: string;
    kind: TerminalKind;
    command: string;
    args: string[];
    cols: number;
    rows: number;
    env?: Record<string, string>;
  }): TerminalInfo {
    const worktree = getWorktreeRow(options.worktreeId);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    if (!fs.existsSync(worktree.path)) throw new AppError(422, 'WORKTREE_MISSING', 'Path worktree tidak ditemukan.');

    const id = newId();
    const timestamp = nowIso();
    db.prepare(
      `INSERT INTO terminals (id, worktree_id, title, kind, status, cols, rows, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?)`
    ).run(id, options.worktreeId, options.title, options.kind, options.cols, options.rows, timestamp, timestamp);

    const runtime: Runtime = {
      id,
      pty: null,
      chunks: [],
      bufferSize: 0,
      clients: new Set(),
      log: fs.createWriteStream(path.join(config.logsDir, `${id}.log`), { flags: 'a' }),
      stopping: false,
      exitCode: null
    };
    this.runtimes.set(id, runtime);
    this.spawn(runtime, worktree.path, options.command, options.args, options.cols, options.rows, options.env);

    const row = this.getRow(id);
    if (!row) throw new AppError(500, 'INTERNAL', 'Gagal membuat terminal.');
    return mapTerminal(row);
  }

  private spawn(
    runtime: Runtime,
    cwd: string,
    command: string,
    args: string[],
    cols: number,
    rows: number,
    extraEnv?: Record<string, string>
  ): void {
    const child = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        DORADO_TERMINAL_ID: runtime.id,
        ...extraEnv
      } as Record<string, string>
    });
    runtime.pty = child;

    child.onData((data) => {
      this.append(runtime, data);
      this.broadcast(runtime, { type: 'output', data });
    });

    child.onExit(({ exitCode, signal }) => {
      runtime.exitCode = exitCode;
      runtime.pty = null;
      runtime.log?.end();
      const stopped = runtime.stopping;
      const status: TerminalStatus = stopped ? 'stopped' : 'exited';
      db.prepare('UPDATE terminals SET status = ?, exit_code = ?, updated_at = ? WHERE id = ?').run(
        status,
        exitCode,
        nowIso(),
        runtime.id
      );
      db.prepare(
        "UPDATE sessions SET status = ?, exit_code = ?, ended_at = ? WHERE terminal_id = ? AND status = 'running'"
      ).run(stopped ? 'stopped' : exitCode === 0 ? 'completed' : 'failed', exitCode, nowIso(), runtime.id);
      const message = { type: 'exit', code: exitCode, signal };
      this.broadcast(runtime, message);
      for (const listener of this.exitListeners) listener(runtime.id, exitCode, stopped);
    });
  }

  private append(runtime: Runtime, data: string): void {
    runtime.chunks.push(data);
    runtime.bufferSize += data.length;
    while (runtime.bufferSize > MAX_BUFFER && runtime.chunks.length > 1) {
      const removed = runtime.chunks.shift();
      runtime.bufferSize -= removed?.length ?? 0;
    }
    runtime.log?.write(data);
  }

  private broadcast(runtime: Runtime, message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of runtime.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  replay(id: string): string {
    return this.runtimes.get(id)?.chunks.join('') ?? '';
  }

  attach(id: string, ws: WebSocket): void {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      ws.send(JSON.stringify({ type: 'error', message: 'Terminal tidak aktif di runtime ini.' }));
      return;
    }
    runtime.clients.add(ws);
    const replay = this.replay(id);
    if (replay) ws.send(JSON.stringify({ type: 'replay', data: replay }));
    if (!runtime.pty) {
      ws.send(JSON.stringify({ type: 'exit', code: runtime.exitCode ?? 0 }));
    }
  }

  detach(id: string, ws: WebSocket): void {
    this.runtimes.get(id)?.clients.delete(ws);
  }

  write(id: string, data: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime?.pty) throw new AppError(409, 'TERMINAL_STOPPED', 'Terminal sudah berhenti.');
    runtime.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const runtime = this.runtimes.get(id);
    if (!runtime?.pty) return;
    runtime.pty.resize(cols, rows);
    db.prepare('UPDATE terminals SET cols = ?, rows = ?, updated_at = ? WHERE id = ?').run(cols, rows, nowIso(), id);
  }

  stop(id: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime?.pty) {
      db.prepare("UPDATE terminals SET status = 'stopped', updated_at = ? WHERE id = ? AND status = 'running'").run(
        nowIso(),
        id
      );
      return;
    }
    runtime.stopping = true;
    runtime.pty.kill('SIGTERM');
  }

  restart(id: string, cols: number, rows: number): TerminalInfo {
    const row = this.getRow(id);
    if (!row) throw notFound('Terminal tidak ditemukan.');
    if (row.kind === 'agent') {
      throw new AppError(422, 'AGENT_TERMINAL', 'Terminal agent tidak dapat di-restart. Buat sesi baru.');
    }
    const worktree = getWorktreeRow(row.worktree_id);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');
    const runtime = this.runtimes.get(id);
    if (runtime?.pty) throw new AppError(409, 'TERMINAL_RUNNING', 'Terminal masih berjalan.');
    if (!runtime) throw new AppError(409, 'TERMINAL_DETACHED', 'Runtime terminal hilang; buat terminal baru.');

    runtime.stopping = false;
    const shell = process.env.SHELL || '/bin/bash';
    db.prepare("UPDATE terminals SET status = 'running', exit_code = NULL, cols = ?, rows = ?, updated_at = ? WHERE id = ?").run(
      cols,
      rows,
      nowIso(),
      id
    );
    this.spawn(runtime, worktree.path, shell, [], cols, rows);
    const updated = this.getRow(id);
    if (!updated) throw new AppError(500, 'INTERNAL', 'Gagal me-restart terminal.');
    return mapTerminal(updated);
  }

  remove(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime?.pty) {
      runtime.stopping = true;
      runtime.pty.kill('SIGTERM');
    }
    runtime?.log?.end();
    this.runtimes.delete(id);
    db.prepare('DELETE FROM terminals WHERE id = ?').run(id);
  }

  markOrphans(): void {
    db.prepare("UPDATE terminals SET status = 'exited', updated_at = ? WHERE status = 'running'").run(nowIso());
    db.prepare("UPDATE sessions SET status = 'failed', ended_at = ? WHERE status = 'running'").run(nowIso());
  }

  shutdown(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.stopping = true;
      runtime.pty?.kill('SIGTERM');
      runtime.log?.end();
    }
    this.runtimes.clear();
  }
}

export const terminalManager = new TerminalManager();