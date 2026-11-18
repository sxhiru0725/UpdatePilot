import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxyApi } from '../../frontend/lib/api-proxy.js';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('/updatepilot_test'))
  throw new Error('Production contract tests require the isolated updatepilot_test database.');
if (testUrl) process.env.DATABASE_URL = testUrl;
// Exercise HTTPS browser policy with a real Express listener and real PostgreSQL.
process.env.WEB_ORIGIN = 'https://frontend.example';
process.env.NODE_ENV = 'production';
process.env.HOST = '0.0.0.0';
const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { passwordHash } = await import('../src/security.js');
const email = `production-contract-${randomUUID()}@example.invalid`;
const password = 'production-contract-fixture-password';
let server: ReturnType<typeof app.listen>;
let userId: string;
let cookie: string;
let csrf: string;
const call = (path: string, options?: RequestInit) =>
  proxyApi(new Request('https://frontend.example/api' + path, options));
const mutate = (origin: string, csrfToken: string) =>
  call('/v1/settings', {
    method: 'PATCH',
    body: JSON.stringify({ retentionDays: 30 }),
    headers: {
      'content-type': 'application/json',
      origin,
      cookie,
      'x-csrf-token': csrfToken,
    },
  });

describe.skipIf(!testUrl)('hosted browser/proxy/Express/PostgreSQL contract', () => {
  beforeAll(async () => {
    userId = (await db.user.create({ data: { email, passwordHash: passwordHash(password) } })).id;
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('API_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (userId) {
      await db.auditEvent.deleteMany({ where: { actorId: userId } });
      await db.session.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    }
    await db.$disconnect();
  });
  it('returns real database readiness and JSON 401 rather than HTML', async () => {
    const health = await call('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ready', database: 'connected' });
    const me = await call('/v1/auth/me');
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: 'Sign in to continue' });
  });
  it('logs in through the proxy with two Secure, Strict, host-only cookies', async () => {
    const response = await call('/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://frontend.example',
      },
      body: JSON.stringify({ email, password }),
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    for (const value of cookies) {
      expect(value).toContain('Secure');
      expect(value).toContain('SameSite=Strict');
      expect(value).not.toContain('Domain=');
    }
    expect(cookies.find((value) => value.startsWith('up_session='))).toContain('HttpOnly');
    expect(cookies.find((value) => value.startsWith('up_csrf='))).not.toContain('HttpOnly');
    cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    csrf = /up_csrf=([^;]+)/.exec(cookie)![1];
    const me = await call('/v1/auth/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).data.email).toBe(email);
  });
  it('preserves exact Origin and session-bound CSRF enforcement', async () => {
    expect((await mutate('https://attacker.example', csrf)).status).toBe(403);
    expect((await mutate('https://frontend.example', 'wrong-token')).status).toBe(403);
    expect((await mutate('https://frontend.example', csrf)).status).toBe(200);
  });
  it('preserves agent authentication and returns safe unknown-route errors', async () => {
    const result = await call('/v1/agent/heartbeat', { method: 'POST', body: '{}' });
    expect(result.status).toBe(401);
    const unknown = await call('/v1/missing', { headers: { cookie } });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Route not found' });
  });
  it('logs out through the proxy and invalidates the stored session', async () => {
    const response = await call('/v1/auth/logout', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://frontend.example',
        'x-csrf-token': csrf,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect((await call('/v1/auth/me', { headers: { cookie } })).status).toBe(401);
  });
});
