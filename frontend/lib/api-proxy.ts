// Server-side only: the browser always calls /api on its own origin.
const failure = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

function backendOrigin(): string {
  const configured = process.env.API_URL?.trim();
  if (!configured && process.env.VERCEL) throw new Error('API_URL is required on Vercel');
  const url = new URL(configured || 'http://127.0.0.1:4310');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !process.env.VERCEL)) ||
    (process.env.VERCEL && loopback)
  )
    throw new Error('API_URL must be an HTTPS backend origin');
  return url.origin;
}

export async function proxyApi(request: Request): Promise<Response> {
  let origin: string;
  try {
    origin = backendOrigin();
  } catch {
    return failure(
      503,
      'UpdatePilot API is not configured. Set API_URL to the deployed HTTPS backend origin.',
    );
  }
  const incoming = new URL(request.url);
  // Concatenation keeps even paths containing // on the configured origin.
  const target = new URL(origin + incoming.pathname + incoming.search);
  if (target.origin === incoming.origin)
    return failure(503, 'API_URL must point to the Express backend, not the frontend.');
  const headers = new Headers();
  for (const name of [
    'accept',
    'content-type',
    'origin',
    'x-csrf-token',
    'authorization',
    'x-agent-timestamp',
    'x-request-id',
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const cookies = request.headers
    .get('cookie')
    ?.split(';')
    .map((value) => value.trim())
    .filter((value) => /^(up_session|up_csrf)=/.test(value))
    .join('; ');
  if (cookies) headers.set('cookie', cookies);
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    // Never follow login/SSO redirects with a user's cookies or agent credentials.
    // Swagger's same-origin directory redirect is the only expected redirect.
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (incoming.pathname === '/api/v1/docs' && location === '/api/v1/docs/')
        return new Response(null, {
          status: upstream.status,
          headers: { Location: location, 'Cache-Control': 'no-store' },
        });
      return failure(
        502,
        'The backend redirected the API request. Check API_URL and backend deployment protection.',
      );
    }
    const type = upstream.headers.get('content-type')?.toLowerCase() ?? '';
    const docs = incoming.pathname.startsWith('/api/v1/docs/');
    const csv = /^\/api\/v1\/exports\/(inventory|history)$/.test(incoming.pathname);
    if (
      request.method !== 'HEAD' &&
      upstream.status !== 204 &&
      !type.includes('application/json') &&
      !(upstream.ok && (docs || (csv && type.includes('text/csv'))))
    )
      return failure(
        502,
        'The backend returned a non-JSON API response. Check API_URL and backend health.',
      );
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of [
      'content-type',
      'content-disposition',
      'retry-after',
      'ratelimit',
      'ratelimit-policy',
      'x-content-type-options',
      'content-security-policy',
    ]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // Set-Cookie must remain separate: login/logout set both session and CSRF cookies.
    for (const cookie of upstream.headers.getSetCookie())
      responseHeaders.append('set-cookie', cookie);
    return new Response(
      request.method === 'HEAD' || upstream.status === 204 ? null : await upstream.arrayBuffer(),
      {
        status: upstream.status,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    return error instanceof Error && error.name === 'TimeoutError'
      ? failure(
          504,
          'The UpdatePilot backend timed out. Check backend and database health, then try again.',
        )
      : failure(
          502,
          'Cannot reach the UpdatePilot backend. Check API_URL and that the backend is running.',
        );
  }
}
