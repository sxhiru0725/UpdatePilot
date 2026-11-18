import { proxyApi } from '../../../lib/api-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const GET = proxyApi;
export const HEAD = proxyApi;
export const POST = proxyApi;
export const PATCH = proxyApi;
export const PUT = proxyApi;
export const DELETE = proxyApi;
export const OPTIONS = proxyApi;
