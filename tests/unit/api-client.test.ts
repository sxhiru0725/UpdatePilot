import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../frontend/lib/api.js';

afterEach(() => vi.unstubAllGlobals());

describe('frontend API response contract', () => {
  it.each([200, 404, 502])(
    'rejects HTML with HTTP %s instead of treating it as data',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('<html>Gateway error</html>', {
            status,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      );
      await expect(api('/auth/me')).rejects.toMatchObject({
        status: status === 200 ? 502 : status,
        message: expect.stringContaining('API_URL'),
      });
    },
  );
  it.each(['null', '[]', '{}', '{broken'])('rejects invalid JSON/envelopes: %s', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await expect(api('/auth/me')).rejects.toMatchObject({ status: 502 });
  });
  it('preserves useful JSON errors and HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Sign in to continue' }, { status: 401 })),
    );
    await expect(api('/auth/me')).rejects.toMatchObject({
      status: 401,
      message: 'Sign in to continue',
    });
  });
  it('sends same-origin cookies without caching and accepts null data', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: null }));
    vi.stubGlobal('fetch', fetcher);
    await expect(api('/auth/me')).resolves.toEqual({ data: null });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
});
