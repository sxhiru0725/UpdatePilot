import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyApi } from '../../frontend/lib/api-proxy.js';

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_URL', 'https://backend.example');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const incoming = (path = '/api/v1/auth/me', options?: RequestInit) =>
  new Request('https://frontend.example' + path, options);

describe('same-origin production API proxy', () => {
  it.each([
    '',
    'http://127.0.0.1:4310',
    'http://backend.example',
    'https://backend.example/api/v1',
    'https://user:secret@backend.example',
    'https://backend.example/?secret=value',
  ])('rejects missing/unsafe API_URL: %s', async (value) => {
    vi.stubEnv('API_URL', value);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyApi(incoming());
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('secret');
  });
  it('rejects a proxy loop', async () => {
    vi.stubEnv('API_URL', 'https://frontend.example');
    expect((await proxyApi(incoming())).status).toBe(503);
  });
  it('uses loopback only outside Vercel for existing local usage', async () => {
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('API_URL', '');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: null }));
    vi.stubGlobal('fetch', fetcher);
    expect((await proxyApi(incoming())).status).toBe(200);
    expect(String(fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:4310/api/v1/auth/me');
  });
  it('preserves query, method, body, Origin, CSRF, cookies and both Set-Cookie headers', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.append('set-cookie', 'up_session=fixture; HttpOnly; Secure; SameSite=Strict; Path=/');
    headers.append('set-cookie', 'up_csrf=fixture; Secure; SameSite=Strict; Path=/');
    const fetcher = vi.fn().mockResolvedValue(new Response('{"data":{}}', { headers }));
    vi.stubGlobal('fetch', fetcher);
    const response = await proxyApi(
      incoming('/api/v1/settings?limit=25&search=a%26b', {
        method: 'PATCH',
        body: '{"retentionDays":30}',
        headers: {
          origin: 'https://frontend.example',
          cookie: 'up_session=fixture; unrelated_private_cookie=do-not-forward',
          'x-csrf-token': 'fixture',
          'x-forwarded-for': 'spoofed',
          'x-unrelated-secret': 'not-forwarded',
        },
      }),
    );
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://backend.example/api/v1/settings?limit=25&search=a%26b');
    expect(options.method).toBe('PATCH');
    expect(new TextDecoder().decode(options.body)).toBe('{"retentionDays":30}');
    expect(options.headers.get('origin')).toBe('https://frontend.example');
    expect(options.headers.get('cookie')).toBe('up_session=fixture');
    expect(options.headers.get('x-csrf-token')).toBe('fixture');
    expect(options.headers.has('x-forwarded-for')).toBe(false);
    expect(options.headers.has('x-unrelated-secret')).toBe(false);
    expect(options.redirect).toBe('manual');
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([401, 403, 404, 409, 429, 503])('preserves JSON error HTTP %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Safe error' }, { status })),
    );
    const response = await proxyApi(incoming());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Safe error' });
  });
  it.each([200, 404, 502])(
    'converts upstream HTML HTTP %s into a safe gateway error',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response('<html>private diagnostic</html>', {
            status,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      );
      const response = await proxyApi(incoming());
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('private diagnostic');
    },
  );
  it('blocks backend SSO redirects', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location: 'https://sso.example' } }),
        ),
    );
    expect((await proxyApi(incoming())).status).toBe(502);
  });
  it('keeps CSV exports working', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('name\r\nFixture', {
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename=inventory.csv',
          },
        }),
      ),
    );
    const response = await proxyApi(incoming('/api/v1/exports/inventory'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('inventory.csv');
    expect(await response.text()).toContain('Fixture');
  });
  it.each([
    ['TimeoutError', 504],
    ['TypeError', 502],
  ])('handles %s without exposing upstream diagnostics', async (name, status) => {
    const error = new Error('private connection diagnostic');
    error.name = name;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    const response = await proxyApi(incoming());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('private connection diagnostic');
  });
});
