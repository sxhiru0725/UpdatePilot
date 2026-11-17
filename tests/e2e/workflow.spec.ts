import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { db } = await import('../../backend/src/db.js');
const { passwordHash } = await import('../../backend/src/security.js');
const password = 'Browser-fixture-password-2026';
async function signIn(page: Page) {
  const email = `browser-${randomUUID()}@example.invalid`;
  await db.user.create({ data: { email, passwordHash: passwordHash(password) } });
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).exclude('nextjs-portal').analyze()).violations).toEqual(
    [],
  );
  return email;
}
async function pairingCode(page: Page) {
  await page.getByRole('link', { name: 'Settings & agent', exact: true }).click();
  await page.getByRole('button', { name: 'Generate pairing code' }).click();
  const code = page.locator('.pairing-code code');
  await expect(code).toBeVisible();
  return (await code.innerText()).trim();
}
async function agentRequest(
  request: APIRequestContext,
  token: string,
  endpoint: string,
  data: unknown = {},
) {
  const response = await request.post(`http://127.0.0.1:4311/api/v1/agent${endpoint}`, {
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Agent-Timestamp': String(Date.now()),
      'X-Request-ID': randomUUID(),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
test.afterAll(async () => {
  await db.$disconnect();
});
test('review, approve and verify a fixture update through the browser and authenticated agent protocol', async ({
  page,
  request,
}) => {
  const email = await signIn(page);
  const code = await pairingCode(page);
  const paired = await request.post('http://127.0.0.1:4311/api/v1/agent/pair', {
    data: {
      code,
      name: 'Browser fixture device',
      os: 'Windows test fixture',
      agentVersion: 'test',
    },
  });
  expect(paired.status()).toBe(201);
  const { deviceId, token } = (await paired.json()).data;
  await agentRequest(request, token, '/heartbeat', {
    health: 'READY',
    agentVersion: 'test',
    wingetVersion: 'fixture',
  });
  await page.evaluate(({ email, id }) => localStorage.setItem(`updatepilot-device:${email}`, id), {
    email,
    id: randomUUID(),
  });
  await page.reload();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved device is no longer available' }),
  ).toBeVisible();
  await page.getByLabel('Current device').selectOption(deviceId);
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Scan device' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scan queued' })).toBeVisible();
  const scan = await agentRequest(request, token, '/jobs/claim');
  await agentRequest(request, token, `/jobs/${scan.id}/scan-result`, {
    lease: scan.lease,
    status: 'COMPLETED',
    applications: [
      {
        identity: 'winget|Fixture.BrowserApp|1',
        name: 'Browser fixture application',
        publisher: 'Fixture publisher',
        installedVersion: '1.0',
        availableVersion: '2.0',
        packageId: 'Fixture.BrowserApp',
        source: 'winget',
        status: 'UPDATE_AVAILABLE',
      },
    ],
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('link', { name: /Browser fixture application/ })).toBeVisible();
  // Delay an older real API response while a newer search finishes, then release it.
  let started!: () => void, release!: () => void, finished!: () => void;
  const slowStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const releaseSlow = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slowFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route('**/api/v1/applications?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === 'Browser') {
      const response = await route.fetch();
      started();
      await releaseSlow;
      await route.fulfill({ response });
      finished();
    } else await route.continue();
  });
  await page.getByRole('textbox', { name: 'Search applications' }).fill('Browser');
  await slowStarted;
  await page.getByRole('textbox', { name: 'Search applications' }).fill('No matching package');
  await expect(page.getByRole('heading', { name: 'No matching applications' })).toBeVisible();
  release();
  await slowFinished;
  await expect(page.getByRole('heading', { name: 'No matching applications' })).toBeVisible();
  await page.unroute('**/api/v1/applications?**');
  await page.getByRole('textbox', { name: 'Search applications' }).fill('');
  await expect(page.getByRole('link', { name: /Browser fixture application/ })).toBeVisible();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Fixture.BrowserApp');
  await expect(dialog).toContainText('1.0');
  await expect(dialog).toContainText('2.0');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    [],
  );
  await dialog.getByRole('button', { name: 'Approve & update' }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  const update = await agentRequest(request, token, '/jobs/claim');
  expect(update.packageId).toBe('Fixture.BrowserApp');
  await agentRequest(request, token, `/jobs/${update.id}/progress`, {
    lease: update.lease,
    status: 'VERIFYING',
  });
  await agentRequest(request, token, `/jobs/${update.id}/update-result`, {
    lease: update.lease,
    outcome: 'FINISHED',
    packageId: update.packageId,
    source: 'winget',
    resultingVersion: '2.0',
    exitCode: 0,
  });
  await page.reload();
  await page
    .getByRole('row')
    .filter({ hasText: 'Browser fixture application' })
    .getByRole('button', { name: 'Details' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Completed');
  await expect(page.getByRole('dialog')).toContainText('Version verified');
  await expect(page.getByRole('dialog')).toContainText('Yes');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Security insights', exact: true }).click();
  await expect(page.getByText('Coverage unavailable', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Review available updates' }).click();
  await expect(page.getByRole('heading', { name: 'Updates', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Security insights', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading workspace' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({
    path: 'test-results/mobile-security.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
});

function runAgent(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'agent/src/Start-Agent.ps1',
        '-BackendUrl',
        'http://127.0.0.1:4311',
        ...args,
      ],
      { windowsHide: true },
    );
    let output = '';
    child.stdout.on('data', (b) => {
      output += b.toString();
    });
    child.stderr.on('data', (b) => {
      output += b.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Read-only agent test timed out'));
    }, 120000);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`Agent exited ${code}: ${output}`));
    });
  });
}
test('real signed WinGet agent pairs and persists a read-only Windows inventory', async ({
  page,
}) => {
  test.skip(
    process.platform !== 'win32' ||
      !existsSync('.local/modules/Microsoft.WinGet.Client/1.29.380/Microsoft.WinGet.Client.psd1'),
    'Requires Windows and npm run agent:setup',
  );
  await signIn(page);
  const code = await pairingCode(page);
  const dir = path.resolve('.local', `agent-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const codeFile = path.join(dir, 'pairing-code.txt'),
    credentialFile = path.join(dir, 'credential.xml');
  writeFileSync(codeFile, code, { mode: 0o600 });
  const first = await runAgent([
    '-Once',
    '-PairingCodePath',
    codeFile,
    '-CredentialPath',
    credentialFile,
  ]);
  unlinkSync(codeFile);
  expect(first).toContain('Health: READY');
  const device = await db.device.findFirstOrThrow({
    where: { credentials: { some: {} }, name: process.env.COMPUTERNAME },
    orderBy: { createdAt: 'desc' },
  });
  await page.reload();
  await page.getByLabel('Current device').selectOption(device.id);
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await page.getByRole('button', { name: 'Scan device' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Scan queued' })).toBeVisible();
  const output = await runAgent(['-Once', '-CredentialPath', credentialFile]);
  expect(output).toContain('Job result recorded');
  const scan = await db.job.findFirstOrThrow({
    where: { deviceId: device.id },
    orderBy: { createdAt: 'desc' },
  });
  expect(scan.status).toBe('COMPLETED');
  expect(await db.job.count({ where: { deviceId: device.id, kind: 'UPDATE' } })).toBe(0);
  expect(scan.detectedCount).toBeGreaterThan(0);
  expect(await db.scanSnapshot.count({ where: { jobId: scan.id } })).toBe(scan.detectedCount);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(Math.min(12, scan.detectedCount!));
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.stat-card').first()).toContainText(String(scan.detectedCount));
  await page.screenshot({
    path: 'test-results/real-inventory-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  // This test never creates or claims any UPDATE job and never invokes winget upgrade.
  await db.agentCredential.updateMany({
    where: { deviceId: device.id },
    data: { revokedAt: new Date() },
  });
  await expect(runAgent(['-Once', '-CredentialPath', credentialFile])).rejects.toThrow(
    /Agent exited 1:/,
  );
});
