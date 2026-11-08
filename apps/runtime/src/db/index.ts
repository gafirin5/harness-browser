import fs from 'node:fs';
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
    agent_token_hash TEXT,
    model       TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    exit_code   INTEGER,
    created_at  TEXT NOT NULL,
    started_at  TEXT,
    ended_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS quick_commands (
    id         TEXT PRIMARY KEY,
    scope      TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','project')),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    command    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS diff_comments (
    id          TEXT PRIMARY KEY,
    worktree_id TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS automations (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    worktree_id TEXT REFERENCES worktrees(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    schedule    TEXT NOT NULL,
    prompt      TEXT NOT NULL,
    agent       TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    retry_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    locked_by    TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS automation_runs (
    id            TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    session_id    TEXT,
    status        TEXT NOT NULL,
    error         TEXT,
    started_at    TEXT NOT NULL,
    finished_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS inbox_reads (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    read_at    TEXT NOT NULL,
    PRIMARY KEY (user_id, session_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    ref_id     TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notification_reads (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    read_at         TEXT NOT NULL,
    PRIMARY KEY (user_id, notification_id)
  );

  CREATE TABLE IF NOT EXISTS remote_nodes (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    hostname     TEXT,
    platform     TEXT,
    agents_json  TEXT NOT NULL DEFAULT '[]',
    latency_ms   INTEGER,
    last_seen_at TEXT,
    created_at   TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('ADMIN','VIEWER')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    totp_enabled  INTEGER NOT NULL DEFAULT 0,
    totp_secret_encrypted TEXT,
    totp_last_counter INTEGER,
    totp_confirmed_at TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_ux ON users(lower(username));

  -- Tabel lama; dipertahankan agar database lama bisa dimigrasikan ke users.
  CREATE TABLE IF NOT EXISTS admin_credentials (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    ip           TEXT,
    user_agent   TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    username    TEXT,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    detail      TEXT,
    ip          TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_token_ix ON auth_sessions(token_hash);
  CREATE INDEX IF NOT EXISTS auth_sessions_expiry_ix ON auth_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS audit_logs_created_ix ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS audit_logs_action_ix ON audit_logs(action, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS cli_agents (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    command          TEXT NOT NULL,
    args             TEXT NOT NULL DEFAULT '[]',
    resume_args      TEXT,
    interactive_args TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_races (
    id                 TEXT PRIMARY KEY,
    project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    base_branch        TEXT NOT NULL,
    prompt             TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'running',
    winner_worktree_id TEXT,
    created_at         TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_race_entries (
    id            TEXT PRIMARY KEY,
    race_id       TEXT NOT NULL REFERENCES agent_races(id) ON DELETE CASCADE,
    worktree_id   TEXT NOT NULL,
    agent_id      TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'running',
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS agent_races_project_ix ON agent_races(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS agent_race_entries_race_ix ON agent_race_entries(race_id);

  CREATE INDEX IF NOT EXISTS worktrees_project_ix ON worktrees(project_id);
  CREATE INDEX IF NOT EXISTS terminals_worktree_ix ON terminals(worktree_id);
  CREATE INDEX IF NOT EXISTS sessions_worktree_ix ON sessions(worktree_id);
  CREATE INDEX IF NOT EXISTS quick_commands_project_ix ON quick_commands(project_id);
  CREATE INDEX IF NOT EXISTS diff_comments_worktree_ix ON diff_comments(worktree_id, file_path);
  CREATE INDEX IF NOT EXISTS automations_project_ix ON automations(project_id);
  CREATE INDEX IF NOT EXISTS automations_due_ix ON automations(enabled, next_run_at);
  CREATE INDEX IF NOT EXISTS automation_runs_automation_ix ON automation_runs(automation_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS notifications_created_ix ON notifications(created_at DESC);
  CREATE INDEX IF NOT EXISTS remote_nodes_status_ix ON remote_nodes(status);
`);

// Migrasi database lama: auth_sessions belum memiliki user_id.
const authSessionColumns = db.prepare('PRAGMA table_info(auth_sessions)').all() as Array<{ name: string }>;
if (!authSessionColumns.some((column) => column.name === 'user_id')) {
  db.exec('ALTER TABLE auth_sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1');
}
db.exec('CREATE INDEX IF NOT EXISTS auth_sessions_user_ix ON auth_sessions(user_id)');

// Migrasi database lama: kolom 2FA pada users.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
const addUserColumn = (name: string, ddl: string): void => {
  if (!userColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`);
};
addUserColumn('totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
addUserColumn('totp_secret_encrypted', 'totp_secret_encrypted TEXT');
addUserColumn('totp_last_counter', 'totp_last_counter INTEGER');
addUserColumn('totp_confirmed_at', 'totp_confirmed_at TEXT');

// Migrasi database lama: checkpoint worktree.
const worktreeColumns = db.prepare('PRAGMA table_info(worktrees)').all() as Array<{ name: string }>;
const addWorktreeColumn = (name: string, ddl: string): void => {
  if (!worktreeColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE worktrees ADD COLUMN ${ddl}`);
};
addWorktreeColumn('task_status', "task_status TEXT NOT NULL DEFAULT 'todo'");
addWorktreeColumn('note', "note TEXT NOT NULL DEFAULT ''");

// Migrasi database lama: retry automations.
const automationColumns = db.prepare('PRAGMA table_info(automations)').all() as Array<{ name: string }>;
const addAutomationColumn = (name: string, ddl: string): void => {
  if (!automationColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE automations ADD COLUMN ${ddl}`);
};
addAutomationColumn('retry_count', 'retry_count INTEGER NOT NULL DEFAULT 0');
addAutomationColumn('locked_until', 'locked_until TEXT');
addAutomationColumn('locked_by', 'locked_by TEXT');

// Migrasi database lama: token checkpoint untuk agent.
const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
if (!sessionColumns.some((column) => column.name === 'agent_token_hash')) {
  db.exec('ALTER TABLE sessions ADD COLUMN agent_token_hash TEXT');
}
const addSessionColumn = (name: string, ddl: string): void => {
  if (!sessionColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${ddl}`);
};
addSessionColumn('model', "model TEXT NOT NULL DEFAULT ''");
addSessionColumn('message_count', 'message_count INTEGER NOT NULL DEFAULT 0');
addSessionColumn('parent_session_id', 'parent_session_id TEXT');
db.exec('CREATE INDEX IF NOT EXISTS sessions_agent_token_ix ON sessions(agent_token_hash)');
db.exec('CREATE INDEX IF NOT EXISTS sessions_parent_ix ON sessions(parent_session_id)');

// Reset status node remote saat startup controller
db.prepare("UPDATE remote_nodes SET status = 'offline', latency_ms = NULL WHERE status = 'online'").run();

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
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
