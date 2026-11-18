import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('production deployment guards', () => {
  it.each([
    { NODE_ENV: 'development' },
    { DATABASE_URL: '' },
    { DATABASE_URL: 'private-invalid-url' },
    {
      DATABASE_URL: 'postgresql://fixture:private-password@db.example/updatepilot?sslmode=disable',
    },
    { DIRECT_DATABASE_URL: 'postgresql://fixture:private-password@db.example/updatepilot' },
    { WEB_ORIGIN: 'http://frontend.example' },
    { WEB_ORIGIN: 'private-invalid-origin' },
    { WEB_ORIGIN: 'https://frontend.example/' },
    { HOST: '127.0.0.1' },
  ])('refuses unsafe deployment before running migrations: %j', (overrides) => {
    const result = spawnSync(process.execPath, ['scripts/deploy-backend.mjs', '--migrate-only'], {
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        WEB_ORIGIN: 'https://frontend.example',
        DATABASE_URL:
          'postgresql://fixture:private-password@db.example/updatepilot?sslmode=require',
        DIRECT_DATABASE_URL: '',
        ...overrides,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Prisma schema loaded');
    expect(result.stderr).not.toContain('private-password');
    expect(result.stderr).not.toContain('private-invalid-url');
  });
});
