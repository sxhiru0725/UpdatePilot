import { Prisma, JobStatus } from '@prisma/client';
import { db } from '../db.js';
import { ApiError, hash, secret } from '../security.js';
import type { Observation } from '../contracts.js';
import { updateResult } from '../contracts.js';
import type { z } from 'zod';
export const active = [JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.VERIFYING];
export const running = [JobStatus.RUNNING, JobStatus.VERIFYING];
export function canTransition(from: JobStatus, to: JobStatus) {
  return (
    (from === 'QUEUED' && ['RUNNING', 'CANCELLED', 'INTERRUPTED'].includes(to)) ||
    (from === 'RUNNING' && ['VERIFYING', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(to)) ||
    (from === 'VERIFYING' &&
      [
        'COMPLETED',
        'FAILED',
        'CANCELLED',
        'VERIFICATION_FAILED',
        'RESTART_REQUIRED',
        'INTERRUPTED',
      ].includes(to))
  );
}
export async function audit(
  actorId: string | null,
  deviceId: string | null,
  type: string,
  target?: string,
  metadata?: Prisma.InputJsonValue,
) {
  await db.auditEvent.create({ data: { actorId, deviceId, type, target, metadata } });
}
export async function claim(deviceId: string) {
  return db.$transaction(async (tx) => {
    // Device-level lock serializes competing pollers and checks revocation in the same transaction.
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${deviceId}::uuid FOR UPDATE`;
    const device = await tx.device.findUniqueOrThrow({ where: { id: deviceId } });
    if (device.revokedAt) throw new ApiError(401, 'Device revoked');
    const job = await tx.job.findFirst({
      where: { deviceId, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });
    if (!job) return null;
    const lease = secret();
    const taken = await tx.job.updateMany({
      where: { id: job.id, status: 'QUEUED' },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        leaseHash: hash(lease),
        leaseUntil: new Date(Date.now() + 90000),
      },
    });
    if (!taken.count) return null;
    return {
      id: job.id,
      operation: job.kind,
      packageId: job.packageId,
      source: job.source,
      previousVersion: job.previousVersion,
      targetVersion: job.targetVersion,
      lease,
    };
  });
}
export async function lockJob(
  tx: Prisma.TransactionClient,
  id: string,
  deviceId: string,
  lease: string,
) {
  await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${deviceId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${id}::uuid FOR UPDATE`;
  const job = await tx.job.findFirst({ where: { id, deviceId } });
  if (
    !job ||
    !running.includes(job.status as 'RUNNING' | 'VERIFYING') ||
    job.leaseHash !== hash(lease) ||
    !job.leaseUntil ||
    job.leaseUntil < new Date()
  )
    throw new ApiError(
      409,
      'Job lease expired, completed or invalid; this operation cannot be replayed',
    );
  return job;
}
export async function saveInventory(
  tx: Prisma.TransactionClient,
  deviceId: string,
  jobId: string,
  apps: Observation[],
) {
  const now = new Date();
  await tx.application.updateMany({ where: { deviceId }, data: { present: false } });
  for (const app of apps) {
    const data = { ...app, present: true, lastObserved: now };
    const saved = await tx.application.upsert({
      where: { deviceId_identity: { deviceId, identity: app.identity } },
      create: { ...data, deviceId },
      update: data,
    });
    await tx.scanSnapshot.create({
      data: { jobId, appId: saved.id, version: app.installedVersion, metadata: app },
    });
  }
}
export function updateOutcome(
  result: z.infer<typeof updateResult>,
  job: { targetVersion: string | null; previousVersion: string | null; status: JobStatus },
) {
  if (result.outcome === 'INTERRUPTED') return { status: JobStatus.INTERRUPTED, verified: false };
  if (result.outcome === 'CANCELLED') return { status: JobStatus.CANCELLED, verified: false };
  if (result.outcome === 'FAILED') return { status: JobStatus.FAILED, verified: false };
  const verified =
    job.status === 'VERIFYING' &&
    result.resultingVersion === job.targetVersion &&
    result.resultingVersion !== job.previousVersion;
  if (result.outcome === 'RESTART_REQUIRED')
    return { status: JobStatus.RESTART_REQUIRED, verified };
  if (result.exitCode !== 0) return { status: JobStatus.FAILED, verified: false };
  return { status: verified ? JobStatus.COMPLETED : JobStatus.VERIFICATION_FAILED, verified };
}
export async function maintenance() {
  const now = new Date();
  await db.$transaction(async (tx) => {
    const stale = await tx.job.findMany({
      where: {
        OR: [
          { status: { in: running }, leaseUntil: { lt: now } },
          { status: 'QUEUED', createdAt: { lt: new Date(Date.now() - 30 * 60000) } },
        ],
      },
    });
    for (const job of stale) {
      await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${job.deviceId}::uuid FOR UPDATE`;
      const changed = await tx.job.updateMany({
        where: { id: job.id, status: job.status, leaseUntil: job.leaseUntil },
        data: {
          status: 'INTERRUPTED',
          endedAt: now,
          error:
            'Agent lease or queue expired. Outcome is unknown; rescan before creating a new update.',
          leaseHash: null,
        },
      });
      if (changed.count) {
        if (job.kind === 'UPDATE' && job.appId)
          await tx.application.update({
            where: { id: job.appId },
            data: { status: 'METADATA_UNAVAILABLE', availableVersion: null },
          });
        await tx.auditEvent.create({
          data: {
            actorId: job.initiatorId,
            deviceId: job.deviceId,
            type: 'JOB_INTERRUPTED',
            target: job.id,
          },
        });
      }
    }
  });
  await db.agentNonce.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 10 * 60000) } },
  });
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.pairing.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.updateApproval.deleteMany({ where: { expiresAt: { lt: now } } });
}
