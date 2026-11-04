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

  -- Orchestrator: provider, agent pekerja, task, dan log.
  CREATE TABLE IF NOT EXISTS providers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT NOT NULL,
    provider_type       TEXT NOT NULL CHECK (provider_type IN ('OPENAI','ANTHROPIC','LITELLM','CUSTOM')),
    base_url            TEXT NOT NULL,
    api_key_encrypted   TEXT NOT NULL,
    default_model       TEXT NOT NULL,
    cost_per_1k_tokens  TEXT NOT NULL,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id           INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    code                  TEXT NOT NULL,
    name                  TEXT NOT NULL,
    endpoint_url          TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'IDLE' CHECK (status IN ('IDLE','BUSY','OFFLINE')),
    max_concurrency       INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 10),
    active_tasks_count    INTEGER NOT NULL DEFAULT 0 CHECK (active_tasks_count >= 0),
    auth_token_hash       TEXT NOT NULL,
    auth_token_encrypted  TEXT NOT NULL,
    last_heartbeat_at     TEXT,
    last_error            TEXT,
    is_active             INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    code                  TEXT NOT NULL UNIQUE,
    agent_id              INTEGER NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    provider_id           INTEGER NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    title                 TEXT NOT NULL,
    prompt                TEXT NOT NULL,
    priority              INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1,2,3)),
    status                TEXT NOT NULL DEFAULT 'QUEUED'
                          CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
    token_used            INTEGER NOT NULL DEFAULT 0 CHECK (token_used >= 0),
    cost_per_1k_snapshot  TEXT NOT NULL,
    cost_usd              TEXT NOT NULL DEFAULT '0.0000',
    cancel_reason         TEXT,
    error_message         TEXT,
    result                TEXT,
    retry_of_task_id      INTEGER REFERENCES tasks(id) ON DELETE RESTRICT,
    client_request_id     TEXT,
    started_at            TEXT,
    finished_at           TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id      INTEGER,
    actor_type   TEXT NOT NULL CHECK (actor_type IN ('USER','SYSTEM','AGENT')),
    from_status  TEXT,
    to_status    TEXT NOT NULL,
    log_level    TEXT NOT NULL DEFAULT 'INFO' CHECK (log_level IN ('INFO','WARN','ERROR')),
    message      TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_code_sequences (
    business_date TEXT PRIMARY KEY,
    last_value    INTEGER NOT NULL CHECK (last_value > 0)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS providers_name_lower_ux ON providers(lower(name));
  CREATE UNIQUE INDEX IF NOT EXISTS agents_code_lower_ux ON agents(lower(code));
  CREATE INDEX IF NOT EXISTS agents_token_ix ON agents(auth_token_hash);
  CREATE INDEX IF NOT EXISTS agents_status_ix ON agents(is_active, status);
  CREATE UNIQUE INDEX IF NOT EXISTS tasks_client_request_ux ON tasks(client_request_id) WHERE client_request_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS tasks_queue_ix ON tasks(status, priority DESC, created_at);
  CREATE INDEX IF NOT EXISTS tasks_agent_status_ix ON tasks(agent_id, status);
  CREATE INDEX IF NOT EXISTS tasks_created_ix ON tasks(created_at DESC);
  CREATE INDEX IF NOT EXISTS task_logs_task_ix ON task_logs(task_id, id);

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