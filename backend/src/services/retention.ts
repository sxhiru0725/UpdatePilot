import { db } from '../db.js';
let lastRun = 0;
export async function retention() {
  if (Date.now() - lastRun < 86400000) return;
  const users = await db.user.findMany({ select: { id: true, retentionDays: true } });
  for (const user of users) {
    const cutoff = new Date(Date.now() - user.retentionDays * 86400000);
    await db.$transaction([
      db.job.deleteMany({
        where: {
          initiatorId: user.id,
          endedAt: { lt: cutoff },
          status: { notIn: ['QUEUED', 'RUNNING', 'VERIFYING'] },
        },
      }),
      db.auditEvent.deleteMany({ where: { actorId: user.id, createdAt: { lt: cutoff } } }),
    ]);
  }
  lastRun = Date.now();
}
