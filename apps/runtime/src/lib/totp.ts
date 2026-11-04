import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { encryptSecret } from './secret.js';

authenticator.options = { window: 1, step: 30 };

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  encryptedSecret: string;
}

export async function generateTotpSetup(username: string, issuer = 'Dorado'): Promise<TotpSetup> {
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(username, issuer, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secret, otpauthUrl, qrDataUrl, encryptedSecret: encryptSecret(secret) };
}

export function verifyTotpCode(secret: string, code: string): boolean {
  return authenticator.check(code, secret);
}

export function currentTotpCounter(): number {
  return Math.floor(Date.now() / 30_000);
}
