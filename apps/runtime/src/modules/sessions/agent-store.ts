import { db, nowIso } from '../../db/index.js';
import { AppError, notFound } from '../../lib/errors.js';
import type { AgentDefinition } from './agent-presets.js';

interface CliAgentRow {
  id: string;
  name: string;
  command: string;
  args: string;
  resume_args: string | null;
  interactive_args: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface StoredAgentInput {
  name: string;
  command: string;
  args: string[];
  resumeArgs?: string[];
  interactiveArgs?: string[];
  enabled?: boolean;
}

function parseArgs(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : undefined;
  } catch {
    return undefined;
  }
}

function jsonOrNull(value?: string[]): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null;
}

function mapRow(row: CliAgentRow): AgentDefinition {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: parseArgs(row.args) ?? [],
    ...(parseArgs(row.resume_args) ? { resumeArgs: parseArgs(row.resume_args) } : {}),
    ...(parseArgs(row.interactive_args) ? { interactiveArgs: parseArgs(row.interactive_args) } : {})
  };
}

function getRow(id: string): CliAgentRow | null {
  return (db.prepare('SELECT * FROM cli_agents WHERE id = ?').get(id) as unknown as CliAgentRow | undefined) ?? null;
}

export function listStoredAgents(): AgentDefinition[] {
  const rows = db
    .prepare('SELECT * FROM cli_agents WHERE enabled = 1 ORDER BY lower(name) ASC')
    .all() as unknown as CliAgentRow[];
  return rows.map(mapRow);
}

export function getStoredAgent(id: string): AgentDefinition | null {
  const row = getRow(id);
  return row ? mapRow(row) : null;
}

export function storedAgentExists(id: string): boolean {
  return Boolean(db.prepare('SELECT id FROM cli_agents WHERE id = ?').get(id));
}

export function createStoredAgent(id: string, input: StoredAgentInput): AgentDefinition {
  if (storedAgentExists(id)) {
    throw new AppError(409, 'AGENT_EXISTS', `Agent dengan id "${id}" sudah ada.`);
  }
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO cli_agents (id, name, command, args, resume_args, interactive_args, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.command,
    JSON.stringify(input.args),
    jsonOrNull(input.resumeArgs),
    jsonOrNull(input.interactiveArgs),
    input.enabled === false ? 0 : 1,
    stamp,
    stamp
  );
  return getStoredAgent(id) as AgentDefinition;
}

export function updateStoredAgent(id: string, input: Partial<StoredAgentInput>): AgentDefinition {
  const row = getRow(id);
  if (!row) throw notFound('Agent kustom tidak ditemukan.');
  const args = input.args ?? parseArgs(row.args) ?? [];
  const resumeArgs = input.resumeArgs !== undefined ? input.resumeArgs : parseArgs(row.resume_args);
  const interactiveArgs = input.interactiveArgs !== undefined ? input.interactiveArgs : parseArgs(row.interactive_args);
  const enabled = input.enabled === undefined ? row.enabled : input.enabled ? 1 : 0;
  db.prepare(
    `UPDATE cli_agents
     SET name = ?, command = ?, args = ?, resume_args = ?, interactive_args = ?, enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? row.name,
    input.command ?? row.command,
    JSON.stringify(args),
    jsonOrNull(resumeArgs),
    jsonOrNull(interactiveArgs),
    enabled,
    nowIso(),
    id
  );
  return getStoredAgent(id) as AgentDefinition;
}

export function deleteStoredAgent(id: string): boolean {
  const result = db.prepare('DELETE FROM cli_agents WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
