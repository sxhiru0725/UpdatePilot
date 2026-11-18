import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const { db } = await import('../../backend/src/db.js');
const { passwordHash } = await import('../../backend/src/security.js');
const { maintenance } = await import('../../backend/src/services/jobs.js');
const backend = 'http://127.0.0.1:4311/api/v1';
async function agent(request: APIRequestContext, token: string, path: string, data: object = {}) {
  const response = await request.post(`${backend}/agent${path}`, {
    data,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Request-ID': randomUUID(),
      'X-Agent-Timestamp': String(Date.now()),
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data;
}
test.afterAll(async () => {
  await db.$disconnect();
});
test('dashboard pages, controls, exports, history, settings and negative device states', async ({
  page,
  request,
}) => {
  const email = `controls-${randomUUID()}@example.invalid`,
    password = 'Controls-fixture-password-2026';
  const user = await db.user.create({ data: { email, passwordHash: passwordHash(password) } });
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Connect a Windows device' }).click();
  await page.getByRole('button', { name: 'Generate pairing code' }).click();
  const code = page.locator('.pairing-code code');
  await expect(code).toBeVisible();
  const pair = await request.post(`${backend}/agent/pair`, {
    data: {
      code: await code.innerText(),
      name: 'Controls fixture device',
      os: 'Windows fixture only',
      agentVersion: 'fixture',
    },
  });
  expect(pair.status()).toBe(201);
  const { deviceId, token } = (await pair.json()).data;
  const ready = () =>
    agent(request, token, '/heartbeat', {
      health: 'READY',
      agentVersion: 'fixture',
      wingetVersion: 'fixture',
    });
  await ready();
  await page.reload();
  await page.getByLabel('Current device').selectOption(deviceId);
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('button', { name: 'Scan device' }).click();
  await page.getByRole('link', { name: 'View operation notifications' }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'Software inventory scan' })
    .getByRole('button', { name: 'Details' })
    .click();
  await page.getByRole('button', { name: 'Cancel queued job' }).click();
  await expect(page.locator('tbody')).toContainText('Cancelled');

  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Scan device' }).click();
  const scan = await agent(request, token, '/jobs/claim');
  await page.getByRole('link', { name: 'View all activity' }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: 'Running' })
    .getByRole('button', { name: 'Details' })
    .click();
  await expect(page.getByRole('button', { name: 'Cancel queued job' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh status' }).click();
  const base = {
    publisher: 'Controlled fixture publisher',
    source: 'winget',
    installedVersion: '1.0',
    availableVersion: '1.0',
    status: 'UP_TO_DATE',
  };
  const apps = [
    {
      ...base,
      identity: 'controls-update',
      name: 'Control update',
      packageId: 'Fixture.Controls',
      availableVersion: '2.0',
      status: 'UPDATE_AVAILABLE',
    },
    {
      ...base,
      identity: 'controls-unknown',
      name: 'Unknown app',
      packageId: 'Fixture.Unknown',
      installedVersion: 'Unknown',
      availableVersion: null,
      status: 'UNKNOWN_VERSION',
    },
    {
      ...base,
      identity: 'controls-unmatched',
      name: 'Unmatched app',
      packageId: null,
      source: null,
      availableVersion: null,
      status: 'UNMATCHED',
    },
    {
      ...base,
      identity: 'controls-unsupported',
      name: 'Unsupported app',
      packageId: null,
      source: 'msstore',
      availableVersion: null,
      status: 'UNSUPPORTED',
    },
    {
      ...base,
      identity: 'controls-unavailable',
      name: 'Metadata unavailable app',
      packageId: 'Fixture.Unavailable',
      availableVersion: null,
      status: 'METADATA_UNAVAILABLE',
    },
    ...Array.from({ length: 11 }, (_, i) => ({
      ...base,
      identity: `tool-${i}`,
      name: `Tool ${String(i).padStart(2, '0')}`,
      packageId: `Fixture.Tool${i}`,
    })),
  ];
  await agent(request, token, `/jobs/${scan.id}/scan-result`, {
    lease: scan.lease,
    status: 'COMPLETED',
    applications: apps,
  });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('dialog')).toContainText('Completed');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('link', { name: 'Applications', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(12);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(12);
  for (const [value, name] of [
    ['UNKNOWN_VERSION', 'Unknown app'],
    ['UNSUPPORTED', 'Unsupported app'],
    ['UNMATCHED', 'Unmatched app'],
    ['METADATA_UNAVAILABLE', 'Metadata unavailable app'],
  ]) {
    await page.getByLabel('Filter update status').selectOption(value);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody')).toContainText(name);
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0);
  }
  await page.getByLabel('Filter update status').selectOption('');
  await page.getByLabel('Sort applications').selectOption('name:desc');
  await expect(page.locator('tbody tr').first()).toContainText('Unsupported app');
  await page.getByRole('textbox', { name: 'Search applications' }).fill('Control update');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: /Control update/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Control update', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Release metadata unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Review update' }).click();
  await expect(page.getByRole('dialog')).toContainText('Fixture.Controls');
  // Review also refreshes inventory. Dismissal is intentionally blocked until it finishes.
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await db.job.count({ where: { deviceId, kind: 'UPDATE' } })).toBe(0);
  await page.getByRole('link', { name: 'Back to applications' }).click();
  const inventoryDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'CSV', exact: true }).click();
  const inventoryPath = await (await inventoryDownload).path();
  expect(await readFile(inventoryPath!, 'utf8')).toContain('Control update');
  await page.getByRole('link', { name: /^Updates/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('link', { name: 'Settings & agent', exact: true }).click();
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('History retention', { exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Save preference' }).click();
  await expect(page.getByRole('button', { name: 'Save preference' })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('History retention', { exact: true })).toHaveValue('30');
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).retentionDays).toBe(30);
  const popupWait = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Check backend health' }).click();
  const popup = await popupWait;
  await expect(popup.locator('body')).toContainText('connected');
  await popup.close();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  await page.route('**/api/v1/devices', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  const unavailable = page.getByRole('alert').filter({ hasText: 'Cannot reach UpdatePilot' });
  await expect(unavailable).toBeVisible();
  await page.unroute('**/api/v1/devices');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(unavailable).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings & agent', exact: true }).click();
  expect((await new AxeBuilder({ page }).exclude('nextjs-portal').analyze()).violations).toEqual(
    [],
  );

  await db.device.update({ where: { id: deviceId }, data: { lastSeen: new Date(0) } });
  await page.getByRole('link', { name: /^Updates/ }).click();
  await expect(page.getByRole('button', { name: 'Scan device' })).toBeDisabled();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Agent is offline' })).toBeVisible();
  await agent(request, token, '/heartbeat', {
    health: 'SOURCE_UNAVAILABLE',
    agentVersion: 'fixture',
    wingetVersion: 'fixture',
  });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scan device' })).toBeDisabled();
  await ready();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Scan device' })).toBeEnabled();
  await page.getByRole('button', { name: 'Scan device' }).click();
  const failed = await agent(request, token, '/jobs/claim');
  await agent(request, token, `/jobs/${failed.id}/scan-result`, {
    lease: failed.lease,
    status: 'FAILED',
    error: 'Controlled source failure',
  });
  await page.getByRole('button', { name: 'Scan device' }).click();
  const timedOut = await agent(request, token, '/jobs/claim');
  await db.job.update({ where: { id: timedOut.id }, data: { leaseUntil: new Date(0) } });
  await maintenance();
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByLabel('Filter event type').selectOption('SCAN');
  await page.getByLabel('Filter history status').selectOption('FAILED');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Controlled source failure');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Filter history status').selectOption('INTERRUPTED');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Filter event type').selectOption('AUDIT');
  await page.getByRole('textbox', { name: 'Search history' }).fill('SCAN_FAILED');
  await expect(page.locator('tbody')).toContainText('Scan failed');
  const historyDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const historyPath = await (await historyDownload).path();
  expect(await readFile(historyPath!, 'utf8')).toContain('INTERRUPTED');

  await page.getByRole('link', { name: 'Settings & agent', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Keep connected' }).click();
  expect((await db.device.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt).toBeNull();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.getByRole('button', { name: 'Disconnect device' }).click();
  await expect(page.locator('.device-row')).toContainText('Revoked');
  await page.getByLabel('Account menu').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const missing = await page.goto('/missing-screen');
  expect(missing?.status()).toBe(404);
});
