import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const booleanFromEnv = z
  .union([z.string(), z.boolean()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  EXTRA_ALLOWED_ORIGINS: z.string().default(''),
  APP_TIMEZONE: z.string().min(1).default('Asia/Jakarta'),
  DATABASE_URL: z.string().min(1).default('postgres://orca:orca@127.0.0.1:5432/orca'),
  SESSION_SECRET: z.string().min(32).default('dev-session-secret-change-me-0123456789abcdef'),
  APP_ENCRYPTION_KEY: z.string().default('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='),
  COOKIE_SECURE: booleanFromEnv.default(false),
  BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(10),
  AGENT_DISPATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  AGENT_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  TASK_MAX_DURATION_MS: z.coerce.number().int().positive().default(3_600_000),
  AGENT_KEY_DELIVERY: z.enum(['payload', 'none']).default('payload'),
  ADMIN_EMAIL: z.string().email().default('admin@orca.local'),
  ADMIN_PASSWORD: z.string().min(8).default('admin12345'),
  ADMIN_NAME: z.string().min(1).default('Dimas Admin'),
  LOG_LEVEL: z.string().default('info')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Konfigurasi environment tidak valid: ${issues}`);
}

const env = parsed.data;

const encryptionKey = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');
if (encryptionKey.length !== 32) {
  throw new Error('APP_ENCRYPTION_KEY harus berupa base64 dari tepat 32 byte.');
}

if (env.NODE_ENV === 'production') {
  if (env.SESSION_SECRET.startsWith('dev-session-secret')) {
    throw new Error('SESSION_SECRET default tidak boleh dipakai di produksi.');
  }
  if (env.APP_ENCRYPTION_KEY === 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=') {
    throw new Error('APP_ENCRYPTION_KEY default tidak boleh dipakai di produksi.');
  }
}

const publicOrigin = new URL(env.PUBLIC_BASE_URL).origin;
const extraOrigins = env.EXTRA_ALLOWED_ORIGINS.split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
  appTimezone: env.APP_TIMEZONE,
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET,
  encryptionKey,
  cookieSecure: env.COOKIE_SECURE,
  bcryptCost: env.BCRYPT_COST,
  dispatchTimeoutMs: env.AGENT_DISPATCH_TIMEOUT_MS,
  healthTimeoutMs: env.AGENT_HEALTH_TIMEOUT_MS,
  heartbeatIntervalMs: env.HEARTBEAT_INTERVAL_MS,
  taskMaxDurationMs: env.TASK_MAX_DURATION_MS,
  agentKeyDelivery: env.AGENT_KEY_DELIVERY,
  admin: {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    name: env.ADMIN_NAME
  },
  logLevel: env.LOG_LEVEL,
  allowedOrigins: Array.from(
    new Set([
      publicOrigin,
      `http://localhost:${env.PORT}`,
      `http://127.0.0.1:${env.PORT}`,
      ...extraOrigins
    ])
  )
} as const;
