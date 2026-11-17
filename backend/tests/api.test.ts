import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl) {
  const parsed = new URL(testUrl);
  if (!parsed.pathname.endsWith('/updatepilot_test'))
    throw new Error('Tests require the separate updatepilot_test database');
  process.env.DATABASE_URL = testUrl;
}
const { app } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { passwordHash, hash } = await import('../src/security.js');
const { maintenance } = await import('../src/services/jobs.js');
const { retention } = await import('../src/services/retention.js');
const origin = 'http://localhost:3000';
const password = 'fixture-password-for-tests-only';
let ownerId: string;
let cookie: string;
let csrf: string;
let deviceId: string;
let credential: string;
const owned = (path: string, body: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/v1' + path)
    .set('Origin', origin)
    .set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .send(body);
const read = (path: string) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', cookie);
const agent = (
  path: string,
  body: Record<string, unknown> = {},
  nonce = randomUUID(),
  timestamp = Date.now(),
) =>
  request(app)
    .post('/api/v1/agent' + path)
    .set('Authorization', `Bearer ${credential}`)
    .set('X-Request-ID', nonce)
    .set('X-Agent-Timestamp', String(timestamp))
    .send(body);
const observation = {
  identity: 'winget|Vendor.App|1',
  name: 'Fixture App',
  publisher: 'Fixture publisher',
  packageId: 'Vendor.App',
  source: 'winget',
  installedVersion: '1.0',
  availableVersion: '2.0',
  status: 'UPDATE_AVAILABLE',
};
async function login(email = 'owner@example.invalid') {
  const r = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .send({ email, password });
  expect(r.status).toBe(200);
  const cookies = r.headers['set-cookie'] as unknown as string[];
  cookie = cookies.map((s) => s.split(';')[0]).join('; ');
  csrf = /up_csrf=([^;]+)/.exec(cookie)![1];
}
async function scanned() {
  const scan = await owned(`/devices/${deviceId}/scans`);
  expect(scan.status).toBe(202);
  const claim = await agent('/jobs/claim');
  const r = await agent(`/jobs/${scan.body.data.id}/scan-result`, {
    lease: claim.body.data.lease,
    status: 'COMPLETED',
    applications: [observation],
  });
  expect(r.status).toBe(200);
  return (await read('/applications')).body.data[0];
}
async function approved() {
  const application = await scanned();
  const preview = await owned(`/updates/${application.id}/preview`);
  const queued = await owned(`/updates/${application.id}/execute`, {
    confirmationToken: preview.body.data.confirmationToken,
    confirm: true,
  });
  expect(queued.status).toBe(202);
  const claimed = await agent('/jobs/claim');
  return { application, preview, queued, operation: claimed.body.data };
}
describe.skipIf(!testUrl)('real PostgreSQL API and agent contract', () => {
  beforeAll(async () => {
    await db.$connect();
  });
  beforeEach(async () => {
    // Guarded dedicated database only. Never truncate the demonstration database.
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "User", "Device", "Job", "Application", "ReleaseMetadata", "SecurityFinding" CASCADE',
    );
    ownerId = (
      await db.user.create({
        data: { email: 'owner@example.invalid', passwordHash: passwordHash(password) },
      })
    ).id;
    await db.user.create({
      data: { email: 'other@example.invalid', passwordHash: passwordHash(password) },
    });
    await login();
    const p = await owned('/devices/pair');
    const paired = await request(app).post('/api/v1/agent/pair').send({
      code: p.body.data.code,
      name: 'Fixture Windows',
      os: 'Windows fixture',
      agentVersion: 'test',
    });
    expect(paired.status).toBe(201);
    deviceId = paired.body.data.deviceId;
    credential = paired.body.data.token;
    await agent('/heartbeat', { health: 'READY', agentVersion: 'test', wingetVersion: 'fixture' });
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it('requires authentication, exact Origin and session CSRF', async () => {
    expect((await request(app).get('/api/v1/dashboard')).status).toBe(401);
    expect(
      (await request(app).post('/api/v1/devices/pair').set('Cookie', cookie).send({})).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/devices/pair')
          .set('Cookie', cookie)
          .set('Origin', 'https://attacker.invalid')
          .set('X-CSRF-Token', csrf)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .set('Origin', origin)
          .send({ email: 'owner@example.invalid', password: 'wrong' })
      ).status,
    ).toBe(401);
  });
  it('returns a useful unavailable state when PostgreSQL fails', async () => {
    const query = vi
      .spyOn(db, '$queryRaw')
      .mockRejectedValueOnce(new Error('Fixture database unavailable'));
    try {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(503);
      expect(response.body.error).toContain('Database unavailable');
    } finally {
      query.mockRestore();
    }
  });
  it('rejects unauthorized device access without disclosing existence', async () => {
    await login('other@example.invalid');
    expect((await owned(`/devices/${deviceId}/scans`)).status).toBe(404);
    expect((await read('/devices')).body.data).toHaveLength(0);
  });
  it('pairs once, rejects unknown/expired codes and hashes credentials', async () => {
    const p = await owned('/devices/pair');
    const data = { code: p.body.data.code, name: 'Second', os: 'Windows', agentVersion: 'test' };
    expect((await request(app).post('/api/v1/agent/pair').send(data)).status).toBe(201);
    expect((await request(app).post('/api/v1/agent/pair').send(data)).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/agent/pair')
          .send({ ...data, code: '0'.repeat(64) })
      ).status,
    ).toBe(403);
    const expired = await owned('/devices/pair');
    await db.pairing.updateMany({
      where: { tokenHash: hash(expired.body.data.code) },
      data: { expiresAt: new Date(0) },
    });
    expect(
      (
        await request(app)
          .post('/api/v1/agent/pair')
          .send({ ...data, code: expired.body.data.code })
      ).status,
    ).toBe(403);
    const stored = await db.agentCredential.findFirstOrThrow({ where: { deviceId } });
    expect(stored.tokenHash).toBe(hash(credential));
    expect(JSON.stringify((await read('/devices')).body)).not.toContain(credential);
  });
  it('rejects replayed or stale authenticated agent requests', async () => {
    const nonce = randomUUID();
    expect(
      (
        await agent(
          '/heartbeat',
          { health: 'READY', agentVersion: 'test', wingetVersion: null },
          nonce,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await agent(
          '/heartbeat',
          { health: 'READY', agentVersion: 'test', wingetVersion: null },
          nonce,
        )
      ).status,
    ).toBe(409);
    expect((await agent('/jobs/claim', {}, randomUUID(), Date.now() - 120000)).status).toBe(403);
  });
  it('persists scans and snapshots, serializes jobs and prevents lease replay', async () => {
    const queued = await owned(`/devices/${deviceId}/scans`);
    expect(queued.status).toBe(202);
    expect((await owned(`/devices/${deviceId}/scans`)).status).toBe(409);
    const claim = await agent('/jobs/claim');
    expect(claim.body.data.operation).toBe('SCAN');
    expect((await agent('/jobs/claim')).body.data).toBeNull();
    const result = {
      lease: claim.body.data.lease,
      status: 'COMPLETED',
      applications: [observation],
    };
    expect((await agent(`/jobs/${queued.body.data.id}/scan-result`, result)).status).toBe(200);
    expect((await agent(`/jobs/${queued.body.data.id}/scan-result`, result)).status).toBe(409);
    expect(await db.scanSnapshot.count()).toBe(1);
    expect((await read('/dashboard')).body.data.updates).toBe(1);
    await db.$disconnect();
    await db.$connect();
    expect((await read('/applications')).body.data[0].installedVersion).toBe('1.0');
  });
  it('requires bound explicit approval and blocks arbitrary operation fields', async () => {
    const application = await scanned();
    const preview = await owned(`/updates/${application.id}/preview`);
    const token = preview.body.data.confirmationToken;
    expect(
      (await owned(`/updates/${application.id}/execute`, { confirmationToken: token })).status,
    ).toBe(400);
    expect(
      (
        await owned(`/updates/${application.id}/execute`, {
          confirmationToken: token,
          confirm: true,
          packageId: 'Other.App',
        })
      ).status,
    ).toBe(400);
    const queued = await owned(`/updates/${application.id}/execute`, {
      confirmationToken: token,
      confirm: true,
    });
    expect(queued.status).toBe(202);
    expect(
      (
        await owned(`/updates/${application.id}/execute`, {
          confirmationToken: token,
          confirm: true,
        })
      ).status,
    ).toBe(409);
  });
  it('invalidates approval when inventory changes', async () => {
    const application = await scanned();
    const preview = await owned(`/updates/${application.id}/preview`);
    await db.application.update({
      where: { id: application.id },
      data: { installedVersion: '1.1' },
    });
    expect(
      (
        await owned(`/updates/${application.id}/execute`, {
          confirmationToken: preview.body.data.confirmationToken,
          confirm: true,
        })
      ).status,
    ).toBe(409);
  });
  it('verifies exact observed versions and records actor/history', async () => {
    const { operation } = await approved();
    expect(
      (
        await agent(`/jobs/${operation.id}/progress`, {
          lease: operation.lease,
          status: 'VERIFYING',
        })
      ).status,
    ).toBe(200);
    const result = await agent(`/jobs/${operation.id}/update-result`, {
      lease: operation.lease,
      outcome: 'FINISHED',
      packageId: 'Vendor.App',
      source: 'winget',
      resultingVersion: '2.0',
      exitCode: 0,
    });
    expect(result.body.data).toEqual({ status: 'COMPLETED', verified: true });
    const saved = await db.job.findUniqueOrThrow({ where: { id: operation.id } });
    expect(saved.initiatorId).toBe(ownerId);
    expect(saved.resultingVersion).toBe('2.0');
    expect((await read('/history?type=UPDATE')).body.data).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { type: 'UPDATE_COMPLETED' } })).toBe(1);
  });
  it('records verification failure even for exit code zero', async () => {
    const { operation } = await approved();
    await agent(`/jobs/${operation.id}/progress`, { lease: operation.lease, status: 'VERIFYING' });
    const r = await agent(`/jobs/${operation.id}/update-result`, {
      lease: operation.lease,
      outcome: 'FINISHED',
      packageId: 'Vendor.App',
      source: 'winget',
      resultingVersion: '1.0',
      exitCode: 0,
    });
    expect(r.body.data.status).toBe('VERIFICATION_FAILED');
  });
  it('rejects wrong update identity and records installer failure', async () => {
    const { operation } = await approved();
    const body = {
      lease: operation.lease,
      outcome: 'FAILED',
      packageId: 'Other.App',
      source: 'winget',
      resultingVersion: null,
      exitCode: 5,
      error: 'Fixture failure',
    };
    expect((await agent(`/jobs/${operation.id}/update-result`, body)).status).toBe(409);
    const r = await agent(`/jobs/${operation.id}/update-result`, {
      ...body,
      packageId: 'Vendor.App',
    });
    expect(r.body.data).toEqual({ status: 'FAILED', verified: false });
  });
  it('interrupts expired jobs without automatic reexecution', async () => {
    const { operation } = await approved();
    await db.job.update({ where: { id: operation.id }, data: { leaseUntil: new Date(0) } });
    await maintenance();
    expect((await read(`/jobs/${operation.id}`)).body.data.status).toBe('INTERRUPTED');
    expect(
      (await owned(`/updates/${(await read('/applications')).body.data[0].id}/preview`)).status,
    ).toBe(409);
    expect((await agent('/jobs/claim')).body.data).toBeNull();
    expect(
      (await agent(`/jobs/${operation.id}/progress`, { lease: operation.lease, status: 'RUNNING' }))
        .status,
    ).toBe(409);
  });
  it('rejects offline scans, cancels queued work and revokes credentials', async () => {
    await db.device.update({ where: { id: deviceId }, data: { lastSeen: new Date(0) } });
    expect((await owned(`/devices/${deviceId}/scans`)).status).toBe(409);
    await agent('/heartbeat', { health: 'READY', agentVersion: 'test', wingetVersion: null });
    const queued = await owned(`/devices/${deviceId}/scans`);
    expect((await owned(`/jobs/${queued.body.data.id}/cancel`)).status).toBe(200);
    expect((await owned(`/devices/${deviceId}/revoke`, { confirm: true })).status).toBe(200);
    expect((await agent('/jobs/claim')).status).toBe(401);
  });
  it('exports quoted, scoped CSV and states security coverage honestly', async () => {
    await scanned();
    const csv = await read('/exports/inventory');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Fixture App');
    const security = await read('/security/findings');
    expect(security.body.coverage).toBe('UNAVAILABLE');
    expect(security.body.data).toEqual([]);
  });
  it('enforces ownership on application details, approval and job history', async () => {
    const application = await scanned();
    const job = await db.job.findFirstOrThrow({ where: { deviceId } });
    await login('other@example.invalid');
    expect((await read(`/applications/${application.id}`)).status).toBe(404);
    expect((await read(`/jobs/${job.id}`)).status).toBe(404);
    expect((await owned(`/updates/${application.id}/preview`)).status).toBe(404);
    expect((await read('/history')).body.data).toEqual([]);
    expect((await read('/exports/inventory')).text).not.toContain('Fixture App');
  });
  it('preserves current inventory and snapshots when a later scan fails', async () => {
    await scanned();
    const queued = await owned(`/devices/${deviceId}/scans`);
    const operation = (await agent('/jobs/claim')).body.data;
    expect(
      (
        await agent(`/jobs/${operation.id}/scan-result`, {
          lease: operation.lease,
          status: 'FAILED',
          error: 'Fixture source unavailable',
        })
      ).status,
    ).toBe(200);
    expect((await read(`/scans/${queued.body.data.id}`)).body.data.status).toBe('FAILED');
    expect((await read('/applications')).body.data).toHaveLength(1);
    expect(await db.scanSnapshot.count()).toBe(1);
  });
  it.each([
    {
      outcome: 'FINISHED',
      exitCode: 0,
      version: '2.0',
      phase: false,
      status: 'VERIFICATION_FAILED',
    },
    { outcome: 'FINISHED', exitCode: 5, version: '2.0', phase: true, status: 'FAILED' },
    {
      outcome: 'RESTART_REQUIRED',
      exitCode: 3010,
      version: '1.0',
      phase: true,
      status: 'RESTART_REQUIRED',
    },
    { outcome: 'CANCELLED', exitCode: 1602, version: '1.0', phase: false, status: 'CANCELLED' },
  ])('records $status without inventing update success', async (scenario) => {
    const { operation } = await approved();
    if (scenario.phase) {
      await agent(`/jobs/${operation.id}/progress`, {
        lease: operation.lease,
        status: 'VERIFYING',
      });
      expect(
        (
          await agent(`/jobs/${operation.id}/progress`, {
            lease: operation.lease,
            status: 'RUNNING',
          })
        ).status,
      ).toBe(409);
    }
    const response = await agent(`/jobs/${operation.id}/update-result`, {
      lease: operation.lease,
      outcome: scenario.outcome,
      exitCode: scenario.exitCode,
      resultingVersion: scenario.version,
      packageId: 'Vendor.App',
      source: 'winget',
    });
    expect(response.body.data).toEqual({ status: scenario.status, verified: false });
  });
  it('prunes expired terminal history and snapshots while retaining inventory and queued work', async () => {
    await scanned();
    const expired = new Date(Date.now() - 40 * 86400000);
    await db.user.update({ where: { id: ownerId }, data: { retentionDays: 30 } });
    await db.job.updateMany({
      where: { deviceId, status: 'COMPLETED' },
      data: { createdAt: expired, startedAt: expired, endedAt: expired },
    });
    await db.auditEvent.create({
      data: { actorId: ownerId, deviceId, type: 'FIXTURE_EXPIRED', createdAt: expired },
    });
    const queued = await owned(`/devices/${deviceId}/scans`);
    await retention();
    expect(await db.scanSnapshot.count()).toBe(0);
    expect(await db.application.count({ where: { deviceId, present: true } })).toBe(1);
    expect((await read(`/jobs/${queued.body.data.id}`)).body.data.status).toBe('QUEUED');
    expect(await db.auditEvent.count({ where: { type: 'FIXTURE_EXPIRED' } })).toBe(0);
  });
});
