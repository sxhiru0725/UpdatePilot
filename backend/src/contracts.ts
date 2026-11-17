import { z } from 'zod';
export const uuid = z.string().uuid().length(36);
export const packageId = z
  .string()
  .min(3)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9._+-]+$/)
  .refine((value) => !/[\r\n]/.test(value), 'Package identities cannot contain line breaks');
export const version = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._+()~-]*$/)
  .refine((value) => !/[\r\n]/.test(value), 'Versions cannot contain line breaks');
const text = z.string().min(1).max(500);
export const observation = z
  .object({
    identity: text,
    name: text,
    publisher: text.nullable(),
    installedVersion: z.string().max(100),
    availableVersion: version.nullable(),
    packageId: packageId.nullable(),
    source: z.string().max(200).nullable(),
    status: z.enum([
      'UPDATE_AVAILABLE',
      'UP_TO_DATE',
      'UNKNOWN_VERSION',
      'UNMATCHED',
      'UNSUPPORTED',
      'METADATA_UNAVAILABLE',
    ]),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      ['UPDATE_AVAILABLE', 'UP_TO_DATE'].includes(a.status) &&
      (!a.packageId ||
        a.source !== 'winget' ||
        !a.availableVersion ||
        !a.installedVersion ||
        /^unknown$/i.test(a.installedVersion))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Reliable identity and versions are required for this status',
      });
    if (a.status === 'UPDATE_AVAILABLE' && a.availableVersion === a.installedVersion)
      ctx.addIssue({ code: 'custom', message: 'Update target must differ from installed version' });
    if (a.status === 'UP_TO_DATE' && a.availableVersion !== a.installedVersion)
      ctx.addIssue({
        code: 'custom',
        message: 'Current status requires an exact source version match',
      });
  });
export const scanResult = z
  .object({
    lease: z.string().length(64),
    status: z.enum(['COMPLETED', 'FAILED', 'INTERRUPTED']),
    applications: z.array(observation).max(10000).optional(),
    error: z.string().max(1000).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.status === 'COMPLETED' && !r.applications)
      ctx.addIssue({ code: 'custom', message: 'Completed scans require inventory' });
    const ids = r.applications?.map((a) => a.identity) ?? [];
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate inventory identities' });
  });
export const updateResult = z
  .object({
    lease: z.string().length(64),
    outcome: z.enum(['FINISHED', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'RESTART_REQUIRED']),
    packageId,
    source: z.literal('winget'),
    resultingVersion: version.nullable(),
    exitCode: z.number().int(),
    error: z.string().max(1000).nullable().optional(),
  })
  .strict();
export type Observation = z.infer<typeof observation>;
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (a === b) return 0;
  if (!/^\d+(\.\d+){0,7}$/.test(a) || !/^\d+(\.\d+){0,7}$/.test(b)) return null;
  const aa = a.split('.').map(BigInt),
    bb = b.split('.').map(BigInt);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i] ?? 0n,
      y = bb[i] ?? 0n;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
