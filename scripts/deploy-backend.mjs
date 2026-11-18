import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Secrets come from the hosting provider, never a checked-in production env file.
if (process.env.NODE_ENV !== 'production')
  throw new Error('This entry point requires NODE_ENV=production.');
for (const name of ['DATABASE_URL', 'WEB_ORIGIN', 'HOST']) {
  if (!process.env[name]) throw new Error(`Missing production environment variable: ${name}`);
}
for (const name of ['DATABASE_URL', 'DIRECT_DATABASE_URL']) {
  if (!process.env[name]) continue;
  let url;
  try {
    url = new URL(process.env[name]);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection string.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['require', 'verify-full'].includes(url.searchParams.get('sslmode') ?? '')
  )
    throw new Error(`${name} must be a PostgreSQL connection string requiring TLS.`);
}
let web;
try {
  web = new URL(process.env.WEB_ORIGIN);
} catch {
  throw new Error('WEB_ORIGIN must be a valid HTTPS origin.');
}
if (
  web.protocol !== 'https:' ||
  web.origin !== process.env.WEB_ORIGIN ||
  process.env.HOST !== '0.0.0.0'
)
  throw new Error('Hosted deployment requires an exact HTTPS WEB_ORIGIN and HOST=0.0.0.0.');
const migrated = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules/prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    path.join(root, 'database/prisma/schema.prisma'),
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
    },
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (migrated.status !== 0) process.exit(migrated.status ?? 1);
if (!process.argv.includes('--migrate-only')) {
  const server = spawn(process.execPath, [path.join(root, 'backend/dist/server.js')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
  server.on('error', () => {
    console.error('Could not start the backend.');
    process.exitCode = 1;
  });
  server.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}
