/**
 * Aritmetika uang berbasis integer skala-4 (1 unit = USD 0.0001).
 * Menghindari galat floating point dan memastikan pembulatan half-up.
 */

const DECIMAL_4_RE = /^\d{1,6}(?:\.\d{1,4})?$/;

export function isValidDecimal4(value: string): boolean {
  return DECIMAL_4_RE.test(value);
}

/** "0.0020" -> 20 ; "2" -> 20000 */
export function decimal4ToInt(value: string): number {
  if (!isValidDecimal4(value)) {
    throw new Error(`Nilai desimal tidak valid: ${value}`);
  }
  const [intPart = '0', fracPart = ''] = value.split('.');
  const frac = (fracPart + '0000').slice(0, 4);
  return Number.parseInt(intPart, 10) * 10000 + Number.parseInt(frac, 10);
}

/** 20 -> "0.0020" */
export function intToDecimal4(value: number): string {
  const safe = Math.max(0, Math.trunc(value));
  const whole = Math.floor(safe / 10000);
  const frac = String(safe % 10000).padStart(4, '0');
  return `${whole}.${frac}`;
}

/**
 * cost4 = round_half_up(rate4 * tokenUsed / 1000)
 * rate4 dalam skala 1/10000 USD per 1K token.
 */
export function computeCost4(rate4: number, tokenUsed: number): number {
  if (!Number.isFinite(rate4) || rate4 < 0) throw new Error('Tarif tidak valid');
  if (!Number.isFinite(tokenUsed) || tokenUsed < 0) throw new Error('Token tidak valid');
  const numerator = BigInt(Math.trunc(rate4)) * BigInt(Math.trunc(tokenUsed));
  const rounded = (numerator + 500n) / 1000n;
  return Number(rounded);
}

/** rate "0.0020", token 2500 -> "0.0050" */
export function computeCostUsd(rate: string, tokenUsed: number): string {
  return intToDecimal4(computeCost4(decimal4ToInt(rate), tokenUsed));
}

export function formatUsd4(value: string | number): string {
  const raw = typeof value === 'number' ? value.toFixed(4) : value;
  const [whole = '0', frac = '0000'] = raw.split('.');
  return `$${whole}.${(frac + '0000').slice(0, 4)}`;
}
