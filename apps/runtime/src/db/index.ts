import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { config } from '../config.js';

// Vite/Vitest 5 belum mengenali node:sqlite sebagai builtin; createRequire
// memastikan modul tetap dimuat oleh Node, bukan di-resolve oleh Vite.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.worktreesDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });

export const db: DatabaseSyncType = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    path       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS worktrees (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch     TEXT NOT NULL,
    path       TEXT NOT NULL UNIQUE,
    base_ref   TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'ready',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS terminals (
    id          TEXT PRIMARY KEY,
    worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('shell','agent')),
    status      TEXT NOT NULL CHECK (status IN ('running','exited','stopped')),
    cols        INTEGER NOT NULL,
    rows        INTEGER NOT NULL,
    exit_code   INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    worktree_id TEXT NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
    terminal_id TEXT NOT NULL,
    agent       TEXT NOT NULL,
    title       TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('running','completed','failed','stopped')),
    exit_code   INTEGER,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    ended_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS pairing_tokens (
    id           TEXT PRIMARY KEY,
    token_hash   TEXT NOT NULL UNIQUE,
    label        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS worktrees_project_ix ON worktrees(project_id);
  CREATE INDEX IF NOT EXISTS terminals_worktree_ix ON terminals(worktree_id);
  CREATE INDEX IF NOT EXISTS sessions_worktree_ix ON sessions(worktree_id);
`);

export function newId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 24);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value
  );
}