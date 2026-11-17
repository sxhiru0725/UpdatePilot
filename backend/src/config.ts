import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
// Built output and source have the same depth.
export const config = z
  .object({
    DATABASE_URL: z.string().url(),
    PORT: z.coerce.number().default(4310),
    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .parse(process.env);
if (!['localhost', '127.0.0.1'].includes(new URL(config.WEB_ORIGIN).hostname))
  throw new Error('This MVP only supports a loopback web origin.');
