import { describe, expect, it, vi } from 'vitest';
import { checkWsOrigin, csrfGuard, requestOrigin } from '../src/modules/auth/middleware.js';

function mockReq(headers: Record<string, string>, method = 'POST', protocol = 'http'): Parameters<typeof csrfGuard>[0] {
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) map[key.toLowerCase()] = value;
  return {
    method,
    protocol,
    get: (name: string) => map[name.toLowerCase()]
  } as unknown as Parameters<typeof csrfGuard>[0];
}

describe('requestOrigin', () => {
  it('memakai Host + X-Forwarded-Proto', () => {
    const req = mockReq({ host: 'dorado.example.com', 'x-forwarded-proto': 'https' });
    expect(requestOrigin(req)).toBe('https://dorado.example.com');
  });

  it('fallback ke req.protocol', () => {
    expect(requestOrigin(mockReq({ host: '127.0.0.1:7788' }, 'GET', 'http'))).toBe('http://127.0.0.1:7788');
  });
});

describe('csrfGuard', () => {
  it('menerima same-origin (Origin == Host) meski tidak di allowedOrigins', () => {
    const next = vi.fn();
    const req = mockReq({
      host: 'baru.trycloudflare.com',
      origin: 'https://baru.trycloudflare.com',
      'x-forwarded-proto': 'https'
    });
    csrfGuard(req, {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('menolak cross-origin', () => {
    const next = vi.fn();
    const req = mockReq({
      host: 'dorado.example.com',
      origin: 'https://evil.example.com',
      'x-forwarded-proto': 'https'
    });
    csrfGuard(req, {} as never, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('melewati request baca (GET)', () => {
    const next = vi.fn();
    csrfGuard(mockReq({ host: 'x', origin: 'https://evil.example.com' }, 'GET'), {} as never, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('checkWsOrigin', () => {
  it('menerima same-origin', () => {
    const req = mockReq({ host: 'dorado.example.com', 'x-forwarded-proto': 'https' });
    expect(checkWsOrigin('https://dorado.example.com', req)).toBe(true);
    expect(checkWsOrigin('https://evil.example.com', req)).toBe(false);
    expect(checkWsOrigin(undefined, req)).toBe(true);
  });
});
