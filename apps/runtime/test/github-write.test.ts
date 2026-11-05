import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { githubWrite } from '../src/modules/github/routes.js';

describe('githubWrite', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mengirim request tulis dengan token dan body JSON', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await githubWrite<{ ok: boolean }>(
      '/repos/o/r/issues/1/comments',
      'POST',
      { body: 'halo' },
      'ghp_test'
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r/issues/1/comments');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_test');
    expect(init.body).toBe(JSON.stringify({ body: 'halo' }));
  });

  it('meneruskan pesan error GitHub sebagai AppError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Resource not accessible' }), {
            status: 403,
            headers: { 'content-type': 'application/json' }
          })
      )
    );

    await expect(githubWrite('/repos/o/r', 'POST', {}, 'ghp_test')).rejects.toMatchObject({
      code: 'GITHUB_ERROR',
      message: 'Resource not accessible'
    });
  });

  it('menolak request tanpa token', async () => {
    await expect(githubWrite('/repos/o/r', 'POST', {}, '')).rejects.toBeInstanceOf(AppError);
    await expect(githubWrite('/repos/o/r', 'POST', {}, '')).rejects.toMatchObject({
      code: 'GITHUB_TOKEN_MISSING'
    });
  });
});
