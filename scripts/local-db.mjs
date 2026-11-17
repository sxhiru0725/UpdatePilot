import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import 'dotenv/config';

const root = process.cwd();
const local = path.join(root, '.local');
const data = path.join(local, 'postgres');
const windows = process.platform === 'win32';
const base = windows ? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL') : '';
const versions = existsSync(base) ? readdirSync(base).sort((a, b) => Number(b) - Number(a)) : [];
const bin =
  process.env.POSTGRES_BIN ?? (windows ? path.join(base, versions[0] ?? '18', 'bin') : '');
const run = (name, args, env = process.env) =>
  execFileSync(path.join(bin, name + (windows ? '.exe' : '')), args, {
    windowsHide: true,
    encoding: 'utf8',
    env,
    stdio: name === 'pg_ctl' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });
mkdirSync(local, { recursive: true });
try {
  if (process.argv[2] === 'stop') {
    run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
    console.log('Project database stopped.');
  } else {
    if (!existsSync(path.join(data, 'PG_VERSION'))) {
      if (existsSync('.env'))
        throw new Error(
          'An .env already exists. Configure that database or move it before creating a new private database.',
        );
      const password = randomBytes(32).toString('hex');
      const pwfile = path.join(local, 'init-password');
      writeFileSync(pwfile, password, { mode: 0o600 });
      try {
        run('initdb', [
          '-D',
          data,
          '-U',
          'updatepilot',
          '--pwfile',
          pwfile,
          '--auth-host=scram-sha-256',
          '--auth-local=scram-sha-256',
          '--encoding=UTF8',
          '--locale=C',
        ]);
      } finally {
        unlinkSync(pwfile);
      }
      writeFileSync(
        '.env',
        `DATABASE_URL=postgresql://updatepilot:${password}@127.0.0.1:55432/updatepilot?schema=public\nPORT=4310\nWEB_ORIGIN=http://localhost:3000\nNODE_ENV=development\n`,
        { mode: 0o600 },
      );
    }
    let running = false;
    try {
      run('pg_ctl', ['-D', data, 'status']);
      running = true;
    } catch {
      /* stopped */
    }
    if (!running)
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        path.join(local, 'postgres.log'),
        '-o',
        '-h 127.0.0.1 -p 55432',
        '-w',
        'start',
      ]);
    const content = readFileSync('.env', 'utf8');
    const url = new URL(content.match(/^DATABASE_URL=(.+)$/m)?.[1] ?? '');
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
    const output = run(
      'psql',
      [
        '-h',
        '127.0.0.1',
        '-p',
        '55432',
        '-U',
        'updatepilot',
        '-d',
        'postgres',
        '-tAc',
        "SELECT 1 FROM pg_database WHERE datname='updatepilot'",
      ],
      env,
    );
    if (!output.trim())
      run('createdb', ['-h', '127.0.0.1', '-p', '55432', '-U', 'updatepilot', 'updatepilot'], env);
    console.log('Private PostgreSQL ready on 127.0.0.1:55432. Credentials are in ignored .env.');
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgresql:\/\/[^\s]+/g, '[redacted database URL]')
      : 'Database setup failed',
  );
  process.exitCode = 1;
}
