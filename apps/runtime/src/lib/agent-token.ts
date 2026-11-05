import crypto from 'node:crypto';

export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createAgentToken(): { token: string; hash: string } {
  const token = `dorado_${crypto.randomBytes(24).toString('hex')}`;
  return { token, hash: hashAgentToken(token) };
}
