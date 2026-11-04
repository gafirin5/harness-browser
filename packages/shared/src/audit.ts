export interface AuditEntry {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

export const AUDIT_ACTIONS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGE',
  '2FA_SETUP',
  '2FA_ENABLED',
  '2FA_DISABLED',
  'USER_CREATE',
  'USER_UPDATE',
  'USER_PASSWORD_RESET',
  'USER_2FA_RESET',
  'PAIRING_CREATE',
  'PAIRING_REVOKE',
  'SESSION_REVOKE_OTHERS'
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN: 'Login',
  LOGIN_FAILED: 'Login gagal',
  LOGOUT: 'Logout',
  PASSWORD_CHANGE: 'Ganti password',
  '2FA_SETUP': 'Setup 2FA',
  '2FA_ENABLED': '2FA diaktifkan',
  '2FA_DISABLED': '2FA dinonaktifkan',
  USER_CREATE: 'User dibuat',
  USER_UPDATE: 'User diperbarui',
  USER_PASSWORD_RESET: 'Password user direset',
  USER_2FA_RESET: '2FA user direset',
  PAIRING_CREATE: 'Pairing token dibuat',
  PAIRING_REVOKE: 'Pairing token dicabut',
  SESSION_REVOKE_OTHERS: 'Sesi lain dicabut'
};
