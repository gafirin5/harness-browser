import { execFileSync } from 'node:child_process';
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
const TMUX_SOCKET = path.join(config.dataDir, 'tmux.sock');
const TMUX_CONF = path.join(config.dataDir, 'tmux.conf');
const LAUNCHER = path.join(config.dataDir, 'terminal-launcher.mjs');
const LAUNCHER_DIR = path.join(config.dataDir, 'launchers');

const LAUNCHER_SOURCE = `import fs from 'node:fs';
import { spawn } from 'node:child_process';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const child = spawn(cfg.command, cfg.args, { cwd: cfg.cwd, env: { ...process.env, ...(cfg.env || {}) }, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { try { child.kill(signal); } catch {} });
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
`;

interface Runtime {
  id: string;
  pty: IPty | null;
  chunks: string[];
  bufferSize: number;
  clients: Set<WebSocket>;
  log: fs.WriteStream | null;
  stopping: boolean;
  detaching: boolean;
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

function sessionName(id: string): string {
  return `dorado-${id}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function ensureHostFiles(): void {
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
  if (!fs.existsSync(TMUX_CONF)) {
    fs.writeFileSync(
      TMUX_CONF,
      ['set -g status off', 'set -g mouse on', 'set -g history-limit 10000', 'set -g default-terminal "xterm-256color"', 'set -g escape-time 10', ''].join(
        '\n'
      )
    );
  }
  if (!fs.existsSync(LAUNCHER)) {
    fs.writeFileSync(LAUNCHER, LAUNCHER_SOURCE);
  }
}

function tmux(args: string[]): string {
  ensureHostFiles();
  return execFileSync('tmux', ['-S', TMUX_SOCKET, '-f', TMUX_CONF, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000
  });
}

function hasSession(id: string): boolean {
  try {
    tmux(['has-session', '-t', `=${sessionName(id)}`]);
    return true;
  } catch {
    return false;
  }
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
    ) as unknown as TerminalRow[];
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

    const runtime = this.createRuntime(id);
    this.runtimes.set(id, runtime);
    this.startTmux(id, worktree.path, options.command, options.args, options.cols, options.rows, {
      ...options.env,
      DORADO_TERMINAL_ID: id
    });
    this.attachProcess(runtime, worktree.path, options.cols, options.rows);

    const row = this.getRow(id);
    if (!row) throw new AppError(500, 'INTERNAL', 'Gagal membuat terminal.');
    return mapTerminal(row);
  }

  private createRuntime(id: string): Runtime {
    return {
      id,
      pty: null,
      chunks: [],
      bufferSize: 0,
      clients: new Set(),
      log: fs.createWriteStream(path.join(config.logsDir, `${id}.log`), { flags: 'a' }),
      stopping: false,
      detaching: false,
      exitCode: null
    };
  }

  private startTmux(
    id: string,
    cwd: string,
    command: string,
    args: string[],
    cols: number,
    rows: number,
    env: Record<string, string>
  ): void {
    ensureHostFiles();
    const configPath = path.join(LAUNCHER_DIR, `${id}.json`);
    fs.writeFileSync(configPath, JSON.stringify({ command, args, cwd, env }), { mode: 0o600 });
    const commandLine = `exec ${shellQuote(process.execPath)} ${shellQuote(LAUNCHER)} ${shellQuote(configPath)}`;
    try {
      tmux([
        'new-session',
        '-d',
        '-s',
        sessionName(id),
        '-c',
        cwd,
        '-x',
        String(cols),
        '-y',
        String(rows),
        commandLine
      ]);
    } catch (error) {
      const message = (error as { stderr?: string; message?: string }).stderr || (error as Error).message;
      db.prepare("UPDATE terminals SET status = 'exited', exit_code = 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
      throw new AppError(500, 'TERMINAL_HOST_ERROR', `Gagal menjalankan tmux: ${message.slice(0, 500)}`);
    }
    if (!hasSession(id)) {
      db.prepare("UPDATE terminals SET status = 'exited', exit_code = 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
      throw new AppError(500, 'TERMINAL_HOST_ERROR', 'Sesi tmux gagal dibuat.');
    }
  }

  private attachProcess(runtime: Runtime, cwd: string, cols: number, rows: number): boolean {
    if (runtime.pty) return true;
    if (!hasSession(runtime.id)) return false;
    const child = pty.spawn(
      'tmux',
      ['-S', TMUX_SOCKET, '-f', TMUX_CONF, 'attach-session', '-t', `=${sessionName(runtime.id)}`],
      {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
      }
    );
    runtime.pty = child;

    child.onData((data) => {
      this.append(runtime, data);
      this.broadcast(runtime, { type: 'output', data });
    });

    child.onExit(({ exitCode }) => {
      runtime.exitCode = exitCode;
      runtime.pty = null;
      if (runtime.detaching) return;
      const alive = hasSession(runtime.id);
      if (!runtime.stopping && alive) {
        // Attach client berhenti tetapi sesi tmux masih hidup; biarkan status running
        // agar koneksi berikutnya bisa attach ulang.
        return;
      }
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
      this.broadcast(runtime, { type: 'exit', code: exitCode });
      for (const listener of this.exitListeners) listener(runtime.id, exitCode, stopped);
    });
    return true;
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
    const row = this.getRow(id);
    if (!row) {
      ws.send(JSON.stringify({ type: 'error', message: 'Terminal tidak ditemukan.' }));
      return;
    }
    const worktree = getWorktreeRow(row.worktree_id);
    if (!worktree) {
      ws.send(JSON.stringify({ type: 'error', message: 'Worktree tidak ditemukan.' }));
      return;
    }

    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = this.createRuntime(id);
      this.runtimes.set(id, runtime);
    }
    runtime.clients.add(ws);

    if (!runtime.pty) {
      const attached = this.attachProcess(runtime, worktree.path, row.cols, row.rows);
      if (!attached) {
        try {
          const full = fs.readFileSync(path.join(config.logsDir, `${id}.log`));
          const data = full.subarray(Math.max(0, full.length - MAX_BUFFER)).toString('utf8');
          if (data) ws.send(JSON.stringify({ type: 'replay', data }));
        } catch {
          // log belum ada
        }
        ws.send(JSON.stringify({ type: 'exit', code: row.exit_code ?? 0 }));
        return;
      }
    }

    const replay = this.replay(id);
    if (replay) ws.send(JSON.stringify({ type: 'replay', data: replay }));
  }

  detach(id: string, ws: WebSocket): void {
    this.runtimes.get(id)?.clients.delete(ws);
  }

  write(id: string, data: string): void {
    const runtime = this.runtimes.get(id);
    if (!runtime?.pty) throw new AppError(409, 'TERMINAL_STOPPED', 'Terminal sudah berhenti.');
    // xterm.js menjawab query terminal (DA/DSR) lewat input handler. tmux
    // meneruskan jawaban itu ke pane sebagai teks, sehingga prompt tercemar.
    const cleaned = data
      .replace(/\x1b\[\?[0-9;]*c/g, '')
      .replace(/\x1b\[[>][0-9;]*c/g, '')
      .replace(/\x1b\[[0-9]+;[0-9]+R/g, '');
    if (cleaned) runtime.pty.write(cleaned);
  }

  resize(id: string, cols: number, rows: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime?.pty) runtime.pty.resize(cols, rows);
    db.prepare('UPDATE terminals SET cols = ?, rows = ?, updated_at = ? WHERE id = ?').run(cols, rows, nowIso(), id);
  }

  stop(id: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime) runtime.stopping = true;
    if (hasSession(id)) {
      try {
        tmux(['kill-session', '-t', `=${sessionName(id)}`]);
      } catch {
        // sesi sudah hilang
      }
    }
    if (runtime?.pty) {
      runtime.pty.kill('SIGTERM');
    } else {
      db.prepare("UPDATE terminals SET status = 'stopped', updated_at = ? WHERE id = ? AND status = 'running'").run(
        nowIso(),
        id
      );
      db.prepare(
        "UPDATE sessions SET status = 'stopped', ended_at = ? WHERE terminal_id = ? AND status = 'running'"
      ).run(nowIso(), id);
    }
  }

  restart(id: string, cols: number, rows: number): TerminalInfo {
    const row = this.getRow(id);
    if (!row) throw notFound('Terminal tidak ditemukan.');
    if (row.kind === 'agent') {
      throw new AppError(422, 'AGENT_TERMINAL', 'Terminal agent tidak dapat di-restart. Buat sesi baru.');
    }
    const worktree = getWorktreeRow(row.worktree_id);
    if (!worktree) throw notFound('Worktree tidak ditemukan.');

    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = this.createRuntime(id);
      this.runtimes.set(id, runtime);
    }
    if (runtime.pty && hasSession(id)) throw new AppError(409, 'TERMINAL_RUNNING', 'Terminal masih berjalan.');

    runtime.stopping = false;
    if (!hasSession(id)) {
      this.startTmux(id, worktree.path, process.env.SHELL || '/bin/bash', [], cols, rows, {
        DORADO_TERMINAL_ID: id
      });
    }
    db.prepare("UPDATE terminals SET status = 'running', exit_code = NULL, cols = ?, rows = ?, updated_at = ? WHERE id = ?").run(
      cols,
      rows,
      nowIso(),
      id
    );
    this.attachProcess(runtime, worktree.path, cols, rows);
    const updated = this.getRow(id);
    if (!updated) throw new AppError(500, 'INTERNAL', 'Gagal me-restart terminal.');
    return mapTerminal(updated);
  }

  remove(id: string): void {
    const runtime = this.runtimes.get(id);
    if (hasSession(id)) {
      try {
        tmux(['kill-session', '-t', `=${sessionName(id)}`]);
      } catch {
        // abaikan
      }
    }
    if (runtime) {
      runtime.detaching = true;
      runtime.pty?.kill('SIGTERM');
      runtime.log?.end();
    }
    this.runtimes.delete(id);
    const configPath = path.join(LAUNCHER_DIR, `${id}.json`);
    if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
    db.prepare('DELETE FROM terminals WHERE id = ?').run(id);
  }

  reconcileOnStartup(): void {
    const running = db.prepare("SELECT * FROM terminals WHERE status = 'running'").all() as unknown as TerminalRow[];
    for (const row of running) {
      if (!hasSession(row.id)) {
        db.prepare("UPDATE terminals SET status = 'exited', exit_code = 1, updated_at = ? WHERE id = ?").run(
          nowIso(),
          row.id
        );
        db.prepare(
          "UPDATE sessions SET status = 'failed', exit_code = 1, ended_at = ? WHERE terminal_id = ? AND status = 'running'"
        ).run(nowIso(), row.id);
      }
    }
    const exited = db.prepare("SELECT * FROM terminals WHERE status <> 'running'").all() as unknown as TerminalRow[];
    for (const row of exited) {
      if (hasSession(row.id)) {
        db.prepare("UPDATE terminals SET status = 'running', exit_code = NULL, updated_at = ? WHERE id = ?").run(
          nowIso(),
          row.id
        );
      }
    }
  }

  /** Hanya untuk test/CLI: menghentikan semua sesi tmux Dorado. */
  killAllSessions(): void {
    try {
      tmux(['kill-server']);
    } catch {
      // server belum berjalan
    }
    this.runtimes.clear();
  }

  shutdown(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.detaching = true;
      runtime.pty?.kill('SIGTERM');
      runtime.log?.end();
    }
    this.runtimes.clear();
  }
}

export const terminalManager = new TerminalManager();