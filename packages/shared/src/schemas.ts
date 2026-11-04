import { z } from 'zod';

const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Kode 2FA harus 6 digit.');

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username wajib diisi.').max(60).default('admin'),
  password: z.string().min(1, 'Password wajib diisi.').max(200),
  totpCode: totpCodeSchema.optional()
});

export const totpConfirmSchema = z.object({
  code: totpCodeSchema
});

export const totpDisableSchema = z.object({
  password: z.string().min(1, 'Password wajib diisi.').max(200),
  code: totpCodeSchema
});

export const pairSchema = z.object({
  token: z.string().min(16, 'Token pairing tidak valid.').max(200)
});

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Nama project wajib diisi.').max(80),
  path: z.string().trim().min(1, 'Path repo wajib diisi.').max(500)
});

const gitRefSchema = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi.`)
    .max(max)
    .regex(/^(?!-)[A-Za-z0-9._/-]+$/, `${label} mengandung karakter tidak valid.`)
    .refine(
      (value) => !value.includes('..') && !value.endsWith('/') && !value.endsWith('.') && !value.endsWith('.lock'),
      {
        message: `${label} bukan nama ref Git yang valid.`
      }
    );

export const worktreeCreateSchema = z.object({
  projectId: z.string().min(1),
  branch: gitRefSchema('Nama branch', 120),
  baseRef: gitRefSchema('Base ref').default('HEAD')
});

export const terminalCreateSchema = z.object({
  worktreeId: z.string().min(1),
  title: z.string().trim().min(1).max(80).default('Terminal'),
  cols: z.coerce.number().int().min(20).max(400).default(120),
  rows: z.coerce.number().int().min(5).max(200).default(32)
});

export const sessionCreateSchema = z.object({
  worktreeId: z.string().min(1),
  agent: z.string().min(1).max(60),
  title: z.string().trim().min(1, 'Judul sesi wajib diisi.').max(120),
  prompt: z.string().trim().max(20000).optional().default('')
});

export const terminalClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(100000) }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(5).max(200)
  }),
  z.object({ type: z.literal('ping') })
]);

export type TerminalClientMessage = z.infer<typeof terminalClientMessageSchema>;

export type TerminalServerMessage =
  | { type: 'replay'; data: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

export const pairingTokenCreateSchema = z.object({
  label: z.string().trim().min(1).max(80).default('Browser')
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi.').max(200),
    newPassword: z.string().min(8, 'Password baru minimal 8 karakter.').max(200)
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Password baru harus berbeda dari password saat ini.',
    path: ['newPassword']
  });

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username minimal 3 karakter.')
  .max(40, 'Username maksimal 40 karakter.')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username hanya boleh berisi huruf, angka, titik, garis bawah, atau tanda hubung.');

export const userRoleSchema = z.enum(['ADMIN', 'VIEWER']);

export const userCreateSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1, 'Nama wajib diisi.').max(80),
  password: z.string().min(8, 'Password minimal 8 karakter.').max(200),
  role: userRoleSchema.default('VIEWER')
});

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const userResetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password minimal 8 karakter.').max(200)
});

export const quickCommandCreateSchema = z
  .object({
    label: z.string().trim().min(1, 'Label wajib diisi.').max(80),
    command: z.string().trim().min(1, 'Command wajib diisi.').max(4000),
    scope: z.enum(['global', 'project']).default('global'),
    projectId: z.string().min(1).nullable().optional()
  })
  .refine((data) => data.scope !== 'project' || Boolean(data.projectId), {
    message: 'Project wajib dipilih untuk command ber-scope project.',
    path: ['projectId']
  });

export const quickCommandUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    command: z.string().trim().min(1).max(4000).optional(),
    scope: z.enum(['global', 'project']).optional(),
    projectId: z.string().min(1).nullable().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');

export const terminalInputSchema = z.object({
  data: z.string().min(1, 'Input kosong.').max(8000)
});

export const diffCommentCreateSchema = z.object({
  worktreeId: z.string().min(1),
  path: z.string().trim().min(1).max(1000),
  line: z.coerce.number().int().min(1).max(2_000_000),
  body: z.string().trim().min(1, 'Komentar wajib diisi.').max(4000)
});

export const diffCommentUpdateSchema = z
  .object({
    body: z.string().trim().min(1).max(4000).optional(),
    resolved: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Tidak ada perubahan yang dikirim.');
