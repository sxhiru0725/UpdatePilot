import 'dotenv/config';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
const original = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(original.hostname))
  throw new Error('Automated test provisioning only supports a local database.');
const url = new URL(original);
url.pathname = '/updatepilot_test';
const base = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL');
const bin =
  process.env.POSTGRES_BIN ??
  (process.platform === 'win32' && existsSync(base)
    ? path.join(base, readdirSync(base).sort((a, b) => Number(b) - Number(a))[0], 'bin')
    : '');
const exe = (name) => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username)];
const env = {
  ...process.env,
  PGPASSWORD: decodeURIComponent(url.password),
  DATABASE_URL: url.href,
  TEST_DATABASE_URL: url.href,
  NODE_ENV: 'test',
};
const exists = execFileSync(
  exe('psql'),
  [...args, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='updatepilot_test'"],
  { env, encoding: 'utf8', windowsHide: true },
);
if (!exists.trim())
  execFileSync(exe('createdb'), [...args, 'updatepilot_test'], {
    env,
    windowsHide: true,
    stdio: 'inherit',
  });
const run = (file, params) => {
  const result = spawnSync(process.execPath, [file, ...params], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run('node_modules/prisma/build/index.js', [
  'migrate',
  'deploy',
  '--schema',
  'database/prisma/schema.prisma',
]);
if (process.argv[2] === 'e2e')
  run('node_modules/@playwright/test/cli.js', ['test', ...process.argv.slice(3)]);
else run('node_modules/vitest/vitest.mjs', ['run', ...process.argv.slice(2)]);
