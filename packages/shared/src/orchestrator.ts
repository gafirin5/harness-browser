import { z } from 'zod';
import { decimal4ToInt, intToDecimal4, isValidDecimal4 } from './money.js';

/* ---------- types ---------- */

export type OrchProviderType = 'OPENAI' | 'ANTHROPIC' | 'LITELLM' | 'CUSTOM';
export type OrchAgentStatus = 'IDLE' | 'BUSY' | 'OFFLINE';
export type OrchTaskStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type OrchLogLevel = 'INFO' | 'WARN' | 'ERROR';
export type OrchActorType = 'USER' | 'SYSTEM' | 'AGENT';
export type OrchTaskPriority = 1 | 2 | 3;

export interface OrchProvider {
  id: number;
  name: string;
  providerType: OrchProviderType;
  baseUrl: string;
  defaultModel: string;
  costPer1kTokens: string;
  isActive: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchAgent {
  id: number;
  code: string;
  name: string;
  endpointUrl: string;
  providerId: number;
  providerName: string | null;
  providerActive: boolean | null;
  status: OrchAgentStatus;
  maxConcurrency: number;
  activeTasksCount: number;
  isActive: boolean;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchTask {
  id: number;
  code: string;
  title: string;
  prompt: string;
  priority: OrchTaskPriority;
  status: OrchTaskStatus;
  tokenUsed: number;
  costPer1kSnapshot: string;
  costUsd: string;
  cancelReason: string | null;
  errorMessage: string | null;
  result: string | null;
  retryOfTaskId: number | null;
  agentId: number;
  agentCode: string | null;
  agentName: string | null;
  agentActive: boolean | null;
  providerId: number;
  providerName: string | null;
  providerActive: boolean | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrchTaskLog {
  id: number;
  taskId: number;
  userId: number | null;
  actorType: OrchActorType;
  fromStatus: OrchTaskStatus | null;
  toStatus: OrchTaskStatus;
  logLevel: OrchLogLevel;
  message: string;
  createdAt: string;
}

export interface OrchDashboardAlert {
  type: 'AGENT_OFFLINE' | 'TASK_FAILED';
  id: number;
  label: string;
  since: string;
}

export interface OrchDashboardSummary {
  agentsActive: number;
  tasksRunning: number;
  tasksFailedToday: number;
  costTodayUsd: string;
  alerts: OrchDashboardAlert[];
  recentLogs: Array<{
    id: number;
    taskId: number;
    taskCode: string;
    logLevel: OrchLogLevel;
    message: string;
    createdAt: string;
  }>;
}

export interface OrchPaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/* ---------- constants ---------- */

export const ORCH_PROVIDER_TYPES: OrchProviderType[] = ['OPENAI', 'ANTHROPIC', 'LITELLM', 'CUSTOM'];
export const ORCH_AGENT_STATUSES: OrchAgentStatus[] = ['IDLE', 'BUSY', 'OFFLINE'];
export const ORCH_TASK_STATUSES: OrchTaskStatus[] = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

export const ORCH_TASK_STATUS_LABELS: Record<OrchTaskStatus, string> = {
  QUEUED: 'Menunggu',
  RUNNING: 'Berjalan',
  COMPLETED: 'Selesai',
  FAILED: 'Gagal',
  CANCELLED: 'Dibatalkan'
};

export const ORCH_AGENT_STATUS_LABELS: Record<OrchAgentStatus, string> = {
  IDLE: 'IDLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE'
};

export const ORCH_PROVIDER_TYPE_LABELS: Record<OrchProviderType, string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  LITELLM: 'LiteLLM',
  CUSTOM: 'Custom'
};

export const ORCH_LIMITS = {
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

/* ---------- schemas ---------- */

const decimal4String = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => isValidDecimal4(value), 'Tarif harus berupa angka dengan maksimal 4 angka desimal.')
  .transform((value) => intToDecimal4(decimal4ToInt(value)));

const idSchema = z.coerce.number().int().positive('ID tidak valid.');

const urlSchema = z
  .string()
  .trim()
  .max(255, 'URL maksimal 255 karakter.')
  .regex(/^https?:\/\/\S+$/i, 'URL harus diawali http:// atau https://.');

export const orchProviderTypeSchema = z.enum(['OPENAI', 'ANTHROPIC', 'LITELLM', 'CUSTOM']);
export const orchAgentStatusSchema = z.enum(['IDLE', 'BUSY', 'OFFLINE']);
export const orchTaskStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
export const orchLogLevelSchema = z.enum(['INFO', 'WARN', 'ERROR']);

export const orchProviderCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(ORCH_LIMITS.providerNameMin, 'Nama provider minimal 2 karakter.')
    .max(ORCH_LIMITS.providerNameMax, 'Nama provider maksimal 100 karakter.'),
  providerType: orchProviderTypeSchema,
  baseUrl: urlSchema,
  apiKey: z
    .string()
    .min(ORCH_LIMITS.apiKeyMin, 'API key minimal 8 karakter.')
    .max(ORCH_LIMITS.apiKeyMax, 'API key maksimal 255 karakter.'),
  defaultModel: z
    .string()
    .trim()
    .min(2, 'Model default minimal 2 karakter.')
    .max(100, 'Model default maksimal 100 karakter.'),
  costPer1kTokens: decimal4String
});

export const orchProviderUpdateSchema = z
  .object({
    name: z.string().trim().min(ORCH_LIMITS.providerNameMin).max(ORCH_LIMITS.providerNameMax).optional(),
    providerType: orchProviderTypeSchema.optional(),
    baseUrl: urlSchema.optional(),
    apiKey: z.string().min(ORCH_LIMITS.apiKeyMin).max(ORCH_LIMITS.apiKeyMax).optional(),
    defaultModel: z.string().trim().min(2).max(100).optional(),
    costPer1kTokens: decimal4String.optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const orchAgentCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,20}$/, 'Kode agent harus 3-20 karakter alfanumerik atau tanda hubung.'),
  name: z
    .string()
    .trim()
    .min(ORCH_LIMITS.agentNameMin, 'Nama agent minimal 2 karakter.')
    .max(ORCH_LIMITS.agentNameMax, 'Nama agent maksimal 100 karakter.'),
  endpointUrl: urlSchema,
  providerId: idSchema,
  maxConcurrency: z.coerce
    .number()
    .int('Batas konkurensi harus bilangan bulat.')
    .min(ORCH_LIMITS.concurrencyMin, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
    .max(ORCH_LIMITS.concurrencyMax, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
});

export const orchAgentUpdateSchema = z
  .object({
    name: z.string().trim().min(ORCH_LIMITS.agentNameMin).max(ORCH_LIMITS.agentNameMax).optional(),
    endpointUrl: urlSchema.optional(),
    providerId: idSchema.optional(),
    maxConcurrency: z.coerce.number().int().min(ORCH_LIMITS.concurrencyMin).max(ORCH_LIMITS.concurrencyMax).optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

const prioritySchema = z.coerce
  .number()
  .refine((value) => value === 1 || value === 2 || value === 3, 'Prioritas harus 1, 2, atau 3.');

export const orchTaskCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(ORCH_LIMITS.taskTitleMin, 'Judul task minimal 3 karakter.')
    .max(ORCH_LIMITS.taskTitleMax, 'Judul task maksimal 150 karakter.'),
  agentId: idSchema,
  providerId: idSchema,
  priority: prioritySchema,
  prompt: z
    .string()
    .trim()
    .min(ORCH_LIMITS.promptMin, 'Prompt instruksi minimal terdiri dari 10 karakter.')
    .max(ORCH_LIMITS.promptMax, 'Prompt instruksi maksimal 10.000 karakter.')
});

export const orchCancelTaskSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(ORCH_LIMITS.cancelReasonMin, 'Alasan pembatalan wajib diisi minimal 5 karakter.')
    .max(ORCH_LIMITS.cancelReasonMax, 'Alasan pembatalan maksimal 255 karakter.')
});

export const orchAgentResultSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  tokenUsed: z.coerce.number().int('Token harus bilangan bulat.').min(0, 'Token tidak boleh negatif.').optional(),
  result: z.string().max(20000, 'Hasil maksimal 20.000 karakter.').nullish(),
  error: z
    .object({
      message: z.string().trim().min(1, 'Pesan error wajib diisi.').max(2000, 'Pesan error maksimal 2.000 karakter.')
    })
    .nullish()
});

export const orchListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(ORCH_LIMITS.pageSizeMax).optional().default(ORCH_LIMITS.pageSizeDefault)
});

export const orchTaskListQuerySchema = z.object({
  status: orchTaskStatusSchema.optional(),
  agentId: z.coerce.number().int().positive().optional(),
  providerId: z.coerce.number().int().positive().optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(ORCH_LIMITS.pageSizeMax).optional().default(ORCH_LIMITS.pageSizeDefault)
});

export const orchLogQuerySchema = z.object({
  afterId: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(ORCH_LIMITS.logLimitMax).optional().default(ORCH_LIMITS.logLimitDefault)
});

export const orchIdempotencyKeySchema = z.string().uuid('Idempotency-Key harus berupa UUID.');
