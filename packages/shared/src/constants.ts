import { z } from 'zod';

export const agentStatusSchema = z.enum(['IDLE', 'BUSY', 'OFFLINE']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

export const taskStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const providerTypeSchema = z.enum(['OPENAI', 'ANTHROPIC', 'LITELLM', 'CUSTOM']);
export type ProviderType = z.infer<typeof providerTypeSchema>;

export const logLevelSchema = z.enum(['INFO', 'WARN', 'ERROR']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const actorTypeSchema = z.enum(['USER', 'SYSTEM', 'AGENT']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const taskPrioritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const TASK_STATUSES = taskStatusSchema.options;
export const AGENT_STATUSES = agentStatusSchema.options;
export const PROVIDER_TYPES = providerTypeSchema.options;
export const LOG_LEVELS = logLevelSchema.options;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  1: 'Rendah',
  2: 'Normal',
  3: 'Tinggi'
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  QUEUED: 'Menunggu',
  RUNNING: 'Berjalan',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan'
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  IDLE: 'IDLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE'
};

export const COOKIE_NAME = 'orca_session';
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_MS = 60 * 1000;

export const LIMITS = {
  providerNameMin: 2,
  providerNameMax: 100,
  apiKeyMin: 8,
  apiKeyMax: 255,
  agentCodeMin: 3,
  agentCodeMax: 20,
  agentNameMin: 2,
  agentNameMax: 100,
  concurrencyMin: 1,
  concurrencyMax: 10,
  taskTitleMin: 3,
  taskTitleMax: 150,
  promptMin: 10,
  promptMax: 10000,
  cancelReasonMin: 5,
  cancelReasonMax: 255,
  pageSizeDefault: 20,
  pageSizeMax: 100,
  logLimitDefault: 100,
  logLimitMax: 100
} as const;
