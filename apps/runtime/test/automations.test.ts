import { describe, expect, it } from 'vitest';
import { computeNextRun, isScheduleValid } from '../src/modules/automations/service.js';

describe('automation schedule', () => {
  it('memvalidasi preset dan cron sederhana', () => {
    expect(isScheduleValid('manual')).toBe(true);
    expect(isScheduleValid('15m')).toBe(true);
    expect(isScheduleValid('*/10 * * * *')).toBe(true);
    expect(isScheduleValid('0 */2 * * *')).toBe(true);
    expect(isScheduleValid('30 9 * * *')).toBe(true);
    expect(isScheduleValid('setiap hari')).toBe(false);
    expect(isScheduleValid('*/0 * * * *')).toBe(false);
  });

  it('menghitung jadwal berikutnya', () => {
    const base = new Date('2026-11-05T10:00:00.000Z');
    expect(computeNextRun('manual', base)).toBeNull();
    expect(computeNextRun('5m', base)?.toISOString()).toBe('2026-11-05T10:05:00.000Z');
    expect(computeNextRun('1h', base)?.toISOString()).toBe('2026-11-05T11:00:00.000Z');
    expect(computeNextRun('*/15 * * * *', base)?.toISOString()).toBe('2026-11-05T10:15:00.000Z');
    expect(computeNextRun('0 */2 * * *', base)?.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    expect(computeNextRun('30 9 * * *', base)).not.toBeNull();
    expect(computeNextRun('30 9 * * *', base, 'Asia/Jakarta')?.toISOString()).toBe('2026-11-06T02:30:00.000Z');
  });
});
