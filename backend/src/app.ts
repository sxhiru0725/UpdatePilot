import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import swaggerUi from 'swagger-ui-express';
import { db } from './db.js';
import { config } from './config.js';
import {
  ApiError,
  userAuth,
  agentAuth,
  requireOrigin,
  ownedDevice,
  assertOnline,
  secret,
  hash,
  verifyPassword,
  type AuthRequest,
} from './security.js';
import { uuid, scanResult, updateResult } from './contracts.js';
import { audit, claim, lockJob, saveInventory, updateOutcome } from './services/jobs.js';
import { getMetadata } from './services/metadata.js';
import { openapi } from './openapi.js';
import { logger } from './logger.js';
export const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
app.set('trust proxy', config.TRUST_PROXY_HOPS);
// Session, pairing and agent responses must never enter a shared cache.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(
  helmet(),
  cors({ origin: config.WEB_ORIGIN, credentials: true }),
  // Browser and agent send plain JSON. Reject compressed bodies before inflation.
  express.json({ limit: '8mb', inflate: false }),
  cookieParser(),
);
if (config.NODE_ENV !== 'test')
  app.use(
    pinoHttp({
      autoLogging: true,
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
      serializers: { req: (req: Request) => ({ method: req.method, url: req.url?.split('?')[0] }) },
    }),
  );
app.use(
  '/api',
  rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
    },
  }),
);
const authLimit = rateLimit({
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: 'Too many unsuccessful attempts. Wait fifteen minutes and try again.' });
  },
  windowMs: 15 * 60000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: new URL(config.WEB_ORIGIN).protocol === 'https:',
  path: '/',
  maxAge: 8 * 3600000,
};
const idOf = (r: Request) => uuid.parse(r.params.id);
const current = (r: Request) => (r as AuthRequest).userId!;
const agentDevice = (r: Request) => (r as AuthRequest).agentDeviceId!;
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().max(200).default(''),
  status: z.string().max(40).optional(),
  deviceId: uuid.optional(),
  sort: z.enum(['name', 'publisher', 'lastObserved', 'createdAt']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  type: z.enum(['SCAN', 'UPDATE', 'AUDIT']).optional(),
});
const jobSelect = {
  id: true,
  kind: true,
  status: true,
  deviceId: true,
  appId: true,
  packageId: true,
  source: true,
  previousVersion: true,
  targetVersion: true,
  resultingVersion: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  exitCode: true,
  verified: true,
  error: true,
  detectedCount: true,
  application: { select: { name: true } },
  device: { select: { name: true } },
  initiator: { select: { email: true } },
} satisfies Prisma.JobSelect;
app.get('/api/health', async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'connected' });
  } catch {
    res.status(503).json({
      status: 'unavailable',
      error: 'Database unavailable. Check PostgreSQL and migrations.',
    });
  }
});
app.post('/api/v1/auth/login', authLimit, requireOrigin, async (req, res) => {
  const { email, password } = z
    .object({ email: z.string().email().max(254), password: z.string().min(1).max(256) })
    .strict()
    .parse(req.body);
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Run scrypt even for missing identities to reduce timing leakage.
  const valid = verifyPassword(
    password,
    user?.passwordHash ?? '00000000000000000000000000000000:' + '00'.repeat(64),
  );
  if (!user || !valid) throw new ApiError(401, 'Email or password is incorrect');
  const token = secret(),
    csrf = secret();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hash(token),
      csrfHash: hash(csrf),
      expiresAt: new Date(Date.now() + 8 * 3600000),
    },
  });
  await audit(user.id, null, 'LOGIN');
  res
    .cookie('up_session', token, cookieOptions)
    .cookie('up_csrf', csrf, { ...cookieOptions, httpOnly: false })
    .json({ data: { email: user.email } });
});
app.post('/api/v1/agent/pair', authLimit, async (req, res) => {
  if (req.get('origin')) throw new ApiError(403, 'Pair using the local Windows agent');
  const body = z
    .object({
      code: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().min(1).max(100),
      os: z.string().min(1).max(200),
      agentVersion: z.string().max(30),
    })
    .strict()
    .parse(req.body);
  const token = secret();
  const device = await db.$transaction(async (tx) => {
    const pairing = await tx.pairing.findUnique({ where: { tokenHash: hash(body.code) } });
    if (!pairing || pairing.usedAt || pairing.expiresAt < new Date())
      throw new ApiError(403, 'Pairing code is invalid, used or expired');
    const consumed = await tx.pairing.updateMany({
      where: { id: pairing.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (!consumed.count) throw new ApiError(409, 'Pairing code already consumed');
    const device = await tx.device.create({
      data: {
        ownerId: pairing.userId,
        name: body.name,
        os: body.os,
        agentVersion: body.agentVersion,
        credentials: {
          create: { tokenHash: hash(token), expiresAt: new Date(Date.now() + 90 * 86400000) },
        },
      },
    });
    await tx.auditEvent.create({
      data: { actorId: pairing.userId, deviceId: device.id, type: 'DEVICE_PAIRED' },
    });
    return device;
  });
  res.status(201).json({ data: { deviceId: device.id, token, expiresInDays: 90 } });
});
// No browser sessions can authorize the agent protocol; every request has a credential and nonce.
const agent = express.Router();
agent.use(agentAuth);
agent.post('/heartbeat', async (req, res) => {
  const body = z
    .object({
      agentVersion: z.string().max(30),
      wingetVersion: z.string().max(50).nullable(),
      health: z.enum(['READY', 'WINGET_UNAVAILABLE', 'MODULE_UNAVAILABLE', 'SOURCE_UNAVAILABLE']),
    })
    .strict()
    .parse(req.body);
  await db.device.update({
    where: { id: agentDevice(req) },
    data: { ...body, lastSeen: new Date() },
  });
  res.json({ data: { connected: true } });
});
agent.post('/jobs/claim', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const device = await db.device.findUniqueOrThrow({ where: { id: agentDevice(req) } });
  assertOnline(device);
  res.json({ data: await claim(device.id) });
});
agent.post('/jobs/:id/progress', async (req, res) => {
  const body = z
    .object({ lease: z.string().length(64), status: z.enum(['RUNNING', 'VERIFYING']) })
    .strict()
    .parse(req.body);
  await db.$transaction(async (tx) => {
    const job = await lockJob(tx, idOf(req), agentDevice(req), body.lease);
    if (job.kind === 'SCAN' && body.status !== 'RUNNING')
      throw new ApiError(409, 'Invalid scan transition');
    if (job.status === 'VERIFYING' && body.status === 'RUNNING')
      throw new ApiError(409, 'Cannot reverse verification');
    await tx.job.update({
      where: { id: job.id },
      data: { status: body.status, leaseUntil: new Date(Date.now() + 90000) },
    });
  });
  res.json({ data: { accepted: true } });
});
agent.post('/jobs/:id/scan-result', async (req, res) => {
  const body = scanResult.parse(req.body);
  await db.$transaction(
    async (tx) => {
      const job = await lockJob(tx, idOf(req), agentDevice(req), body.lease);
      if (job.kind !== 'SCAN') throw new ApiError(409, 'Not a scan job');
      if (body.status === 'COMPLETED')
        await saveInventory(tx, job.deviceId, job.id, body.applications!);
      await tx.job.update({
        where: { id: job.id },
        data: {
          status: body.status,
          endedAt: new Date(),
          error: body.error,
          detectedCount: body.status === 'COMPLETED' ? body.applications!.length : null,
          leaseHash: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId: job.initiatorId,
          deviceId: job.deviceId,
          type: `SCAN_${body.status}`,
          target: job.id,
        },
      });
    },
    { timeout: 60000 },
  );
  res.json({ data: { accepted: true } });
});
agent.post('/jobs/:id/update-result', async (req, res) => {
  const body = updateResult.parse(req.body);
  const result = await db.$transaction(async (tx) => {
    const job = await lockJob(tx, idOf(req), agentDevice(req), body.lease);
    if (job.kind !== 'UPDATE' || job.packageId !== body.packageId || job.source !== body.source)
      throw new ApiError(409, 'Update result identity mismatch');
    const outcome = updateOutcome(body, job);
    const saved = await tx.job.update({
      where: { id: job.id },
      data: {
        ...outcome,
        resultingVersion: body.resultingVersion,
        exitCode: body.exitCode,
        error:
          body.error ??
          (outcome.status === 'VERIFICATION_FAILED'
            ? 'Post-update installed version did not match the approved target.'
            : undefined),
        endedAt: new Date(),
        leaseHash: null,
      },
    });
    if (job.appId)
      await tx.application.update({
        where: { id: job.appId },
        data: {
          ...(body.resultingVersion
            ? { installedVersion: body.resultingVersion, lastObserved: new Date() }
            : {}),
          status: 'METADATA_UNAVAILABLE',
          availableVersion: null,
        },
      });
    await tx.auditEvent.create({
      data: {
        actorId: job.initiatorId,
        deviceId: job.deviceId,
        type: `UPDATE_${saved.status}`,
        target: job.id,
      },
    });
    return { status: saved.status, verified: saved.verified };
  });
  res.json({ data: result });
});
app.use('/api/v1/agent', agent);
const user = express.Router();
user.use(userAuth);
user.get('/auth/me', async (req, res) => {
  res.json({
    data: await db.user.findUnique({
      where: { id: current(req) },
      select: { email: true, retentionDays: true },
    }),
  });
});
user.post('/auth/logout', async (req, res) => {
  await db.session.delete({ where: { id: (req as AuthRequest).sessionId! } });
  res
    .clearCookie('up_session', cookieOptions)
    .clearCookie('up_csrf', { ...cookieOptions, httpOnly: false })
    .json({ data: { signedOut: true } });
});
user.get('/devices', async (req, res) => {
  const devices = await db.device.findMany({
    where: { ownerId: current(req) },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    data: devices.map((d) => ({
      ...d,
      connection: d.revokedAt
        ? 'REVOKED'
        : Date.now() - d.lastSeen.getTime() < 60000
          ? 'ONLINE'
          : 'OFFLINE',
    })),
  });
});
user.post('/devices/pair', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const code = secret();
  await db.pairing.create({
    data: {
      userId: current(req),
      tokenHash: hash(code),
      expiresAt: new Date(Date.now() + 5 * 60000),
    },
  });
  await audit(current(req), null, 'PAIRING_APPROVED');
  res.status(201).json({ data: { code, expiresInSeconds: 300 } });
});
user.post('/devices/:id/revoke', async (req, res) => {
  const device = await ownedDevice(idOf(req), current(req));
  z.object({ confirm: z.literal(true) })
    .strict()
    .parse(req.body);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${device.id}::uuid FOR UPDATE`;
    const runningJob = await tx.job.findFirst({
      where: { deviceId: device.id, status: { in: ['RUNNING', 'VERIFYING'] } },
    });
    if (runningJob)
      throw new ApiError(
        409,
        'Wait for the active operation to finish before revoking this device.',
      );
    await tx.device.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
    await tx.agentCredential.updateMany({
      where: { deviceId: device.id },
      data: { revokedAt: new Date() },
    });
    await tx.job.updateMany({
      where: { deviceId: device.id, status: 'QUEUED' },
      data: { status: 'CANCELLED', endedAt: new Date(), error: 'Device revoked' },
    });
    await tx.auditEvent.create({
      data: { actorId: current(req), deviceId: device.id, type: 'DEVICE_REVOKED' },
    });
  });
  res.json({ data: { revoked: true } });
});
user.post('/devices/:id/scans', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const device = await ownedDevice(idOf(req), current(req));
  assertOnline(device);
  const job = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${device.id}::uuid FOR UPDATE`;
    assertOnline(await tx.device.findUniqueOrThrow({ where: { id: device.id } }));
    const job = await tx.job.create({
      data: { kind: 'SCAN', deviceId: device.id, initiatorId: current(req) },
    });
    await tx.auditEvent.create({
      data: { actorId: current(req), deviceId: device.id, type: 'SCAN_QUEUED', target: job.id },
    });
    return job;
  });
  res.status(202).json({ data: { id: job.id, status: job.status } });
});
user.get('/dashboard', async (req, res) => {
  const deviceId = z.object({ deviceId: uuid.optional() }).parse(req.query).deviceId;
  const deviceWhere = { ownerId: current(req), ...(deviceId ? { id: deviceId } : {}) };
  if (deviceId) await ownedDevice(deviceId, current(req));
  const where = { device: deviceWhere, present: true };
  const [groups, devices, recentJobs, lastScan, daily] = await Promise.all([
    db.application.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.device.count({ where: { ...deviceWhere, revokedAt: null } }),
    db.job.findMany({
      where: { device: deviceWhere },
      select: jobSelect,
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    db.job.findFirst({
      where: { device: deviceWhere, kind: 'SCAN', status: 'COMPLETED' },
      orderBy: { endedAt: 'desc' },
      select: { endedAt: true },
    }),
    db.job.findMany({
      where: { device: deviceWhere, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      select: { createdAt: true, kind: true, status: true },
    }),
  ]);
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  res.json({
    data: {
      total: groups.reduce((n, g) => n + g._count._all, 0),
      upToDate: counts.UP_TO_DATE ?? 0,
      updates: counts.UPDATE_AVAILABLE ?? 0,
      unknown: groups
        .filter((g) => !['UP_TO_DATE', 'UPDATE_AVAILABLE'].includes(g.status))
        .reduce((n, g) => n + g._count._all, 0),
      devices,
      lastScan: lastScan?.endedAt ?? null,
      recentJobs,
      activity: daily,
    },
  });
});
async function applications(req: Request, res: Response, updatesOnly = false) {
  const q = pageQuery.parse(req.query);
  const where: Prisma.ApplicationWhereInput = {
    device: { ownerId: current(req) },
    present: true,
    ...(q.deviceId ? { deviceId: q.deviceId } : {}),
    ...(updatesOnly ? { status: 'UPDATE_AVAILABLE' } : q.status ? { status: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { publisher: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    db.application.findMany({
      where,
      orderBy: { [q.sort === 'createdAt' ? 'lastObserved' : q.sort]: q.order },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.application.count({ where }),
  ]);
  res.json({ data, pagination: { page: q.page, limit: q.limit, total } });
}
user.get('/applications', (req, res) => applications(req, res));
user.get('/updates', (req, res) => applications(req, res, true));
user.get('/applications/:id', async (req, res) => {
  const application = await db.application.findFirst({
    where: { id: idOf(req), device: { ownerId: current(req) } },
  });
  if (!application) throw new ApiError(404, 'Application not found');
  const metadata =
    application.packageId && application.availableVersion && application.source === 'winget'
      ? await getMetadata(application.packageId, application.availableVersion)
      : null;
  const jobs = await db.job.findMany({
    where: { appId: application.id },
    select: jobSelect,
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  res.json({ data: { ...application, metadata, jobs } });
});
async function eligible(id: string, userId: string) {
  const application = await db.application.findFirst({
    where: { id, device: { ownerId: userId } },
    include: { device: true },
  });
  if (!application) throw new ApiError(404, 'Application not found');
  assertOnline(application.device);
  if (
    !application.present ||
    application.status !== 'UPDATE_AVAILABLE' ||
    !application.packageId ||
    application.source !== 'winget' ||
    !application.availableVersion ||
    Date.now() - application.lastObserved.getTime() > 30 * 60000
  )
    throw new ApiError(409, 'A fresh scan with a supported update is required');
  return application;
}
user.post('/updates/:id/preview', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const application = await eligible(idOf(req), current(req));
  const confirmationToken = secret();
  await db.updateApproval.create({
    data: {
      userId: current(req),
      appId: application.id,
      tokenHash: hash(confirmationToken),
      fromVersion: application.installedVersion,
      targetVersion: application.availableVersion!,
      observedAt: application.lastObserved,
      expiresAt: new Date(Date.now() + 5 * 60000),
    },
  });
  res.json({
    data: {
      application,
      confirmationToken,
      expiresInSeconds: 300,
      permissions:
        'Runs as your Windows user. A publisher installer may require Windows approval; UpdatePilot never elevates itself. Save your work and close this application. Restart requirements may be unknown until installation finishes.',
    },
  });
});
user.post('/updates/:id/execute', async (req, res) => {
  const body = z
    .object({ confirmationToken: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) })
    .strict()
    .parse(req.body);
  const application = await eligible(idOf(req), current(req));
  const job = await db.$transaction(async (tx) => {
    // Inventory, claim and approval execution all serialize on this device.
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${application.deviceId}::uuid FOR UPDATE`;
    const freshDevice = await tx.device.findUniqueOrThrow({ where: { id: application.deviceId } });
    assertOnline(freshDevice);
    const fresh = await tx.application.findUniqueOrThrow({ where: { id: application.id } });
    const approval = await tx.updateApproval.findUnique({
      where: { tokenHash: hash(body.confirmationToken) },
    });
    if (
      !approval ||
      approval.userId !== current(req) ||
      approval.appId !== fresh.id ||
      approval.consumedAt ||
      approval.expiresAt < new Date() ||
      approval.fromVersion !== fresh.installedVersion ||
      approval.targetVersion !== fresh.availableVersion ||
      approval.observedAt.getTime() !== fresh.lastObserved.getTime() ||
      fresh.status !== 'UPDATE_AVAILABLE' ||
      !fresh.present
    )
      throw new ApiError(
        409,
        'Approval is stale, invalid or already used. Review the update again.',
      );
    const used = await tx.updateApproval.updateMany({
      where: { id: approval.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (!used.count) throw new ApiError(409, 'Approval already used');
    const job = await tx.job.create({
      data: {
        kind: 'UPDATE',
        deviceId: fresh.deviceId,
        appId: fresh.id,
        initiatorId: current(req),
        packageId: fresh.packageId,
        source: fresh.source,
        previousVersion: fresh.installedVersion,
        targetVersion: fresh.availableVersion,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: current(req),
        deviceId: fresh.deviceId,
        type: 'UPDATE_APPROVED',
        target: job.id,
        metadata: { packageId: fresh.packageId, targetVersion: fresh.availableVersion },
      },
    });
    return job;
  });
  res.status(202).json({ data: { id: job.id, status: job.status } });
});
user.get(['/jobs/:id', '/scans/:id'], async (req, res) => {
  const job = await db.job.findFirst({
    where: { id: idOf(req), device: { ownerId: current(req) } },
    select: jobSelect,
  });
  if (!job) throw new ApiError(404, 'Job not found');
  res.json({ data: job });
});
user.post('/jobs/:id/cancel', async (req, res) => {
  z.object({}).strict().parse(req.body);
  const count = await db.job.updateMany({
    where: { id: idOf(req), device: { ownerId: current(req) }, status: 'QUEUED' },
    data: { status: 'CANCELLED', endedAt: new Date() },
  });
  if (!count.count)
    throw new ApiError(
      409,
      'Only a queued job can be cancelled. Running installers cannot be safely rolled back.',
    );
  await audit(current(req), null, 'JOB_CANCELLED', idOf(req));
  res.json({ data: { status: 'CANCELLED' } });
});
user.get('/history', async (req, res) => {
  const q = pageQuery.parse(req.query);
  if (q.type === 'AUDIT') {
    const where: Prisma.AuditEventWhereInput = {
      actorId: current(req),
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.search ? { type: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [data, total] = await Promise.all([
      db.auditEvent.findMany({
        where,
        orderBy: { createdAt: q.order },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
      }),
      db.auditEvent.count({ where }),
    ]);
    res.json({ data, pagination: { total, page: q.page, limit: q.limit } });
    return;
  }
  const status = q.status
    ? z
        .enum([
          'QUEUED',
          'RUNNING',
          'VERIFYING',
          'COMPLETED',
          'FAILED',
          'CANCELLED',
          'INTERRUPTED',
          'RESTART_REQUIRED',
          'VERIFICATION_FAILED',
        ])
        .parse(q.status)
    : undefined;
  const where: Prisma.JobWhereInput = {
    device: { ownerId: current(req) },
    ...(q.deviceId ? { deviceId: q.deviceId } : {}),
    ...(q.type ? { kind: q.type } : {}),
    ...(status ? { status } : {}),
    ...(q.search
      ? {
          OR: [
            { packageId: { contains: q.search, mode: 'insensitive' } },
            { device: { name: { contains: q.search, mode: 'insensitive' } } },
            { application: { name: { contains: q.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    db.job.findMany({
      where,
      select: jobSelect,
      orderBy: { createdAt: q.order },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.job.count({ where }),
  ]);
  res.json({ data, pagination: { total, page: q.page, limit: q.limit } });
});
user.get('/security/findings', (_req, res) =>
  res.json({
    data: [],
    coverage: 'UNAVAILABLE',
    explanation:
      'Reliable WinGet-to-vulnerability ecosystem matching is not implemented. No findings does not establish that installed software is secure.',
  }),
);
user.get('/settings', async (req, res) =>
  res.json({
    data: await db.user.findUnique({
      where: { id: current(req) },
      select: { retentionDays: true },
    }),
  }),
);
user.patch('/settings', async (req, res) => {
  const body = z
    .object({ retentionDays: z.number().int().min(30).max(365) })
    .strict()
    .parse(req.body);
  await db.user.update({ where: { id: current(req) }, data: body });
  await audit(current(req), null, 'SETTINGS_CHANGED', undefined, body);
  res.json({ data: body });
});
export const csvCell = (v: unknown) =>
  '"' +
  String(v ?? '')
    .replace(/^(?:\s*[=+@-]|[\t\r\n])/, "'$&")
    .replaceAll('"', '""') +
  '"';
user.get('/exports/:kind', async (req, res) => {
  const kind = z.enum(['inventory', 'history']).parse(req.params.kind);
  const deviceId = z.object({ deviceId: uuid.optional() }).parse(req.query).deviceId;
  const rows =
    kind === 'inventory'
      ? await db.application.findMany({
          where: {
            device: { ownerId: current(req) },
            present: true,
            ...(deviceId ? { deviceId } : {}),
          },
          select: {
            name: true,
            publisher: true,
            packageId: true,
            source: true,
            installedVersion: true,
            availableVersion: true,
            status: true,
            lastObserved: true,
          },
          take: 50000,
        })
      : await db.job.findMany({
          where: { device: { ownerId: current(req) }, ...(deviceId ? { deviceId } : {}) },
          select: {
            id: true,
            kind: true,
            packageId: true,
            status: true,
            previousVersion: true,
            targetVersion: true,
            resultingVersion: true,
            verified: true,
            createdAt: true,
            endedAt: true,
            error: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50000,
        });
  const keys = Object.keys(
    rows[0] ??
      (kind === 'inventory'
        ? { name: '', publisher: '', installedVersion: '' }
        : { id: '', kind: '', status: '' }),
  );
  const csv = [
    keys.map(csvCell).join(','),
    ...rows.map((row) => keys.map((k) => csvCell((row as Record<string, unknown>)[k])).join(',')),
  ].join('\r\n');
  await audit(current(req), deviceId ?? null, 'CSV_EXPORTED', kind);
  res.setHeader('Content-Disposition', `attachment; filename="updatepilot-${kind}.csv"`);
  res.type('text/csv').send('\uFEFF' + csv);
});
user.get('/openapi.json', (_req, res) => res.json(openapi));
user.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/api/v1', user);
app.use((_req, _res, next) => next(new ApiError(404, 'Route not found')));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (
    typeof error === 'object' &&
    error &&
    'type' in error &&
    error.type === 'encoding.unsupported'
  ) {
    res
      .status(415)
      .json({ error: 'Compressed request bodies are not supported. Send plain JSON.' });
    return;
  }
  if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request exceeds the maximum size.' });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Invalid request',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res
      .status(409)
      .json({ error: 'An operation is already active, or this request was already processed.' });
    return;
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P2024'].includes(error.code))
  ) {
    res.status(503).json({ error: 'Database unavailable. Check PostgreSQL and try again.' });
    return;
  }
  if (
    typeof error === 'object' &&
    error &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    res.status(400).json({ error: 'Malformed JSON request' });
    return;
  }
  logger.error(
    { error: error instanceof Error ? error.name : 'UnknownError' },
    'API request failed',
  );
  res.status(500).json({ error: 'The request could not be completed. Check the backend logs.' });
});
