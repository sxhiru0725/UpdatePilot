import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
// Built output and source have the same depth.
export const config = z
  .object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4310),
    HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .parse(process.env);
const web = new URL(config.WEB_ORIGIN);
if (
  web.origin !== config.WEB_ORIGIN ||
  (web.protocol !== 'https:' &&
    !(web.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(web.hostname)))
)
  throw new Error('WEB_ORIGIN must be an exact HTTPS origin, or HTTP localhost for local use.');
if (config.HOST === '0.0.0.0' && (config.NODE_ENV !== 'production' || web.protocol !== 'https:'))
  throw new Error('A hosted backend requires NODE_ENV=production and an HTTPS WEB_ORIGIN.');
