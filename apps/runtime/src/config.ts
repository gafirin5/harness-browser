import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';
import { z } from 'zod';
import { parseAllowedOrigins } from './lib/origins.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(7788),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:7788'),
  DATA_DIR: z.string().default('./data'),
  ADMIN_PASSWORD: z.string().min(4).default('dorado'),
  SESSION_SECRET: z.string().min(32).default('dev-session-secret-change-me-0123456789abcdef'),
  PAIRING_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : typeof value === 'boolean'
          ? value
          : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
    ),
  DORADO_AGENTS: z.string().default(''),
  PROJECT_SCAN_ROOTS: z.string().default(''),
  ALLOWED_ORIGINS: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  APP_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),
  APP_ENCRYPTION_KEY: z.string().default('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
  AGENT_DISPATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AGENT_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  TASK_MAX_DURATION_MS: z.coerce.number().int().positive().default(3_600_000),
  AGENT_KEY_DELIVERY: z.enum(['payload', 'none']).default('payload')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Konfigurasi tidak valid: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}
const env = parsed.data;

if (env.NODE_ENV === 'production') {
  if (env.SESSION_SECRET.startsWith('dev-session-secret')) {
    throw new Error('SESSION_SECRET default tidak boleh dipakai di produksi.');
  }
  if (env.ADMIN_PASSWORD === 'dorado') {
    throw new Error('ADMIN_PASSWORD default tidak boleh dipakai di produksi.');
  }
}

const dataDir = path.resolve(env.DATA_DIR.startsWith('~') ? env.DATA_DIR.replace('~', os.homedir()) : env.DATA_DIR);
const publicOrigin = new URL(env.PUBLIC_BASE_URL).origin;
const encryptionKey = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
if (encryptionKey.length !== 32) {
  throw new Error('APP_ENCRYPTION_KEY harus berupa base64 dari tepat 32 byte.');
}
if (env.NODE_ENV === 'production' && env.APP_ENCRYPTION_KEY === 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=') {
  throw new Error('APP_ENCRYPTION_KEY default tidak boleh dipakai di produksi.');
}

interface ExtraAgent {
  id: string;
  name: string;
  command: string;
  args: string[];
  resumeArgs?: string[];
  interactiveArgs?: string[];
  docsUrl?: string;
}

function parseExtraAgents(raw: string): ExtraAgent[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{
      id?: string;
      name?: string;
      command?: string;
      args?: string[];
      resumeArgs?: string[];
      interactiveArgs?: string[];
      docsUrl?: string;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item.id && item.command)
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
        command: String(item.command),
        args: Array.isArray(item.args) ? item.args.map(String) : [],
        ...(Array.isArray(item.resumeArgs) ? { resumeArgs: item.resumeArgs.map(String) } : {}),
        ...(Array.isArray(item.interactiveArgs) ? { interactiveArgs: item.interactiveArgs.map(String) } : {}),
        ...(item.docsUrl ? { docsUrl: String(item.docsUrl) } : {})
      }));
  } catch {
    return [];
  }
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
  dataDir,
  dbPath: path.join(dataDir, 'dorado.db'),
  worktreesDir: path.join(dataDir, 'worktrees'),
  logsDir: path.join(dataDir, 'logs'),
  adminPassword: env.ADMIN_PASSWORD,
  sessionSecret: env.SESSION_SECRET,
  pairingTtlMs: env.PAIRING_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  cookieSecure: env.COOKIE_SECURE ?? new URL(env.PUBLIC_BASE_URL).protocol === 'https:',
  allowedOrigins: Array.from(
    new Set([
      publicOrigin,
      `http://localhost:${env.PORT}`,
      `http://127.0.0.1:${env.PORT}`,
      'http://localhost:5174',
      'http://127.0.0.1:5174',
      ...parseAllowedOrigins(env.ALLOWED_ORIGINS)
    ])
  ),
  extraAgents: parseExtraAgents(env.DORADO_AGENTS),
  projectScanRoots: env.PROJECT_SCAN_ROOTS.split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  githubToken: env.GITHUB_TOKEN,
  appTimezone: env.APP_TIMEZONE,
  encryptionKey,
  dispatchTimeoutMs: env.AGENT_DISPATCH_TIMEOUT_MS,
  healthTimeoutMs: env.AGENT_HEALTH_TIMEOUT_MS,
  heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  taskMaxDurationMs: env.TASK_MAX_DURATION_MS,
  agentKeyDelivery: env.AGENT_KEY_DELIVERY
} as const;
