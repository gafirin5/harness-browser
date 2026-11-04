import { z } from 'zod';

export const loginSchema = z.object({
  password: z.string().min(1, 'Password wajib diisi.').max(200)
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
  prompt: z.string().trim().min(1, 'Prompt wajib diisi.').max(20000)
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
