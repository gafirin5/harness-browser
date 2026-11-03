import { z } from 'zod';
import {
  LIMITS,
  agentStatusSchema,
  providerTypeSchema,
  taskPrioritySchema,
  taskStatusSchema
} from './constants.js';
import { intToDecimal4, decimal4ToInt, isValidDecimal4 } from './money.js';

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

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email wajib diisi.').max(100, 'Email maksimal 100 karakter.').email('Format email tidak valid.'),
  password: z.string().min(1, 'Password wajib diisi.').max(72, 'Password maksimal 72 karakter.')
});

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Password saat ini wajib diisi.').max(72),
    new_password: z.string().min(8, 'Password baru minimal 8 karakter.').max(72, 'Password baru maksimal 72 karakter.')
  })
  .refine((data) => data.current_password !== data.new_password, {
    message: 'Password baru harus berbeda dari password saat ini.',
    path: ['new_password']
  });

export const providerCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(LIMITS.providerNameMin, 'Nama provider minimal 2 karakter.')
    .max(LIMITS.providerNameMax, 'Nama provider maksimal 100 karakter.'),
  provider_type: providerTypeSchema,
  base_url: urlSchema,
  api_key: z
    .string()
    .min(LIMITS.apiKeyMin, 'API key minimal 8 karakter.')
    .max(LIMITS.apiKeyMax, 'API key maksimal 255 karakter.'),
  default_model: z.string().trim().min(2, 'Model default minimal 2 karakter.').max(100, 'Model default maksimal 100 karakter.'),
  cost_per_1k_tokens: decimal4String
});

export const providerUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(LIMITS.providerNameMin, 'Nama provider minimal 2 karakter.')
      .max(LIMITS.providerNameMax, 'Nama provider maksimal 100 karakter.')
      .optional(),
    provider_type: providerTypeSchema.optional(),
    base_url: urlSchema.optional(),
    api_key: z
      .string()
      .min(LIMITS.apiKeyMin, 'API key minimal 8 karakter.')
      .max(LIMITS.apiKeyMax, 'API key maksimal 255 karakter.')
      .optional(),
    default_model: z.string().trim().min(2, 'Model default minimal 2 karakter.').max(100).optional(),
    cost_per_1k_tokens: decimal4String.optional(),
    is_active: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const agentCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,20}$/, 'Kode agent harus 3-20 karakter alfanumerik atau tanda hubung.'),
  name: z
    .string()
    .trim()
    .min(LIMITS.agentNameMin, 'Nama agent minimal 2 karakter.')
    .max(LIMITS.agentNameMax, 'Nama agent maksimal 100 karakter.'),
  endpoint_url: urlSchema,
  provider_id: idSchema,
  max_concurrency: z.coerce
    .number()
    .int('Batas konkurensi harus bilangan bulat.')
    .min(LIMITS.concurrencyMin, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
    .max(LIMITS.concurrencyMax, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
});

export const agentUpdateSchema = z
  .object({
    name: z.string().trim().min(LIMITS.agentNameMin).max(LIMITS.agentNameMax).optional(),
    endpoint_url: urlSchema.optional(),
    provider_id: idSchema.optional(),
    max_concurrency: z.coerce
      .number()
      .int()
      .min(LIMITS.concurrencyMin, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
      .max(LIMITS.concurrencyMax, 'Batas konkurensi harus bernilai antara 1 hingga 10.')
      .optional(),
    is_active: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const taskCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(LIMITS.taskTitleMin, 'Judul task minimal 3 karakter.')
    .max(LIMITS.taskTitleMax, 'Judul task maksimal 150 karakter.'),
  agent_id: idSchema,
  provider_id: idSchema,
  priority: taskPrioritySchema,
  prompt: z
    .string()
    .trim()
    .min(LIMITS.promptMin, 'Prompt instruksi minimal terdiri dari 10 karakter.')
    .max(LIMITS.promptMax, 'Prompt instruksi maksimal 10.000 karakter.')
});

export const cancelTaskSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(LIMITS.cancelReasonMin, 'Alasan pembatalan wajib diisi minimal 5 karakter.')
    .max(LIMITS.cancelReasonMax, 'Alasan pembatalan maksimal 255 karakter.')
});

export const agentResultSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  token_used: z.coerce.number().int('Token harus bilangan bulat.').min(0, 'Token tidak boleh negatif.').optional(),
  result: z.string().max(20000, 'Hasil maksimal 20.000 karakter.').nullish(),
  error: z
    .object({
      message: z.string().trim().min(1, 'Pesan error wajib diisi.').max(2000, 'Pesan error maksimal 2.000 karakter.')
    })
    .nullish()
});

export const providerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).optional().default(LIMITS.pageSizeDefault)
});

export const agentListQuerySchema = providerListQuerySchema;

export const taskListQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  agent_id: z.coerce.number().int().positive().optional(),
  provider_id: z.coerce.number().int().positive().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).optional().default(LIMITS.pageSizeDefault)
});

export const logQuerySchema = z.object({
  after_id: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(LIMITS.logLimitMax).optional().default(LIMITS.logLimitDefault)
});

export const agentStatusQuerySchema = z.object({
  status: agentStatusSchema.optional()
});
