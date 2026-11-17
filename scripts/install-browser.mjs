import { spawnSync } from 'node:child_process';
import path from 'node:path';
const result = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'install', 'chromium', '--only-shell'],
  {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve('.local/browsers') },
    stdio: 'inherit',
    windowsHide: true,
  },
);
process.exitCode = result.status ?? 1;
