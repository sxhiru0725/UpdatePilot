import { parse } from 'yaml';
import { db } from '../db.js';
import { packageId as idSchema, version as versionSchema } from '../contracts.js';
const failures = new Map<string, number>();
const safeUrl = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};
export async function getMetadata(id: string, version: string) {
  idSchema.parse(id);
  versionSchema.parse(version);
  const key = { packageId: id, version, source: 'winget' };
  const cached = await db.releaseMetadata.findUnique({ where: { packageId_version_source: key } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < 86400000) return cached;
  if ((failures.get(`${id}@${version}`) ?? 0) > Date.now()) return cached;
  // Fetch only a known manifest path from Microsoft's official community source; never arbitrary URLs.
  const segments = [id[0].toLowerCase(), ...id.split('.'), version, `${id}.locale.en-US.yaml`]
    .map(encodeURIComponent)
    .join('/');
  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/${segments}`,
      {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        headers: { 'User-Agent': 'UpdatePilot/0.1' },
      },
    );
    if (!response.ok) throw new Error('Metadata unavailable');
    const body = await response.text();
    if (body.length > 512000) throw new Error('Manifest too large');
    const manifest: Record<string, unknown> = parse(body, { maxAliasCount: 10 });
    if (manifest.PackageIdentifier !== id || manifest.PackageVersion !== version)
      throw new Error('Manifest identity mismatch');
    const data = {
      ...key,
      publisher: typeof manifest.Publisher === 'string' ? manifest.Publisher.slice(0, 500) : null,
      officialUrl: safeUrl(manifest.PackageUrl ?? manifest.PublisherUrl),
      changelogUrl: safeUrl(manifest.ReleaseNotesUrl),
      releaseNotes:
        typeof manifest.ReleaseNotes === 'string' ? manifest.ReleaseNotes.slice(0, 20000) : null,
      fetchedAt: new Date(),
    };
    return await db.releaseMetadata.upsert({
      where: { packageId_version_source: key },
      create: data,
      update: data,
    });
  } catch {
    if (failures.size > 1000) failures.clear();
    failures.set(`${id}@${version}`, Date.now() + 15 * 60000);
    return cached;
  }
}
