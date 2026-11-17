import { defineConfig } from '@playwright/test';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve('.local/browsers');
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('/updatepilot_test')
)
  throw new Error('Use npm run test:e2e with an isolated test database.');
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  reporter: 'list',
  use: {
    actionTimeout: 20000,
    navigationTimeout: 30000,
    baseURL: 'http://localhost:3001',
    browserName: 'chromium',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:backend',
      url: 'http://127.0.0.1:4311/api/health',
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        PORT: '4311',
        WEB_ORIGIN: 'http://localhost:3001',
      },
      timeout: 60000,
    },
    {
      command: 'node node_modules/next/dist/bin/next dev frontend --hostname localhost --port 3001',
      url: 'http://localhost:3001',
      reuseExistingServer: false,
      env: { NODE_ENV: 'development', UPDATEPILOT_E2E: '1', API_URL: 'http://127.0.0.1:4311' },
      timeout: 90000,
    },
  ],
});
