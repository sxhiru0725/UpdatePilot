import { beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith('/updatepilot_test'))
  throw new Error('Dedicated test database required');
if (testUrl) process.env.DATABASE_URL = testUrl;
const { db } = await import('../src/db.js');
const { getMetadata } = await import('../src/services/metadata.js');
describe.skipIf(!testUrl)('trusted manifest metadata persistence', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.releaseMetadata.deleteMany();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await db.$disconnect();
  });
  it('fetches only the exact Microsoft manifest and reuses its persistent cache', async () => {
    const mocked = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          'PackageIdentifier: Fixture.Metadata\nPackageVersion: "2.0"\nPublisher: Fixture publisher\nReleaseNotes: Changes\nReleaseNotesUrl: https://example.invalid/releases/2\n',
        ),
      );
    const result = await getMetadata('Fixture.Metadata', '2.0');
    expect(result?.publisher).toBe('Fixture publisher');
    expect(result?.channel).toBeNull();
    expect(mocked.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/f/Fixture/Metadata/2.0/Fixture.Metadata.locale.en-US.yaml',
    );
    expect((await getMetadata('Fixture.Metadata', '2.0'))?.id).toBe(result?.id);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
  it('rejects metadata for a mismatched package identity', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('PackageIdentifier: Other.App\nPackageVersion: "2.0"\n'),
    );
    expect(await getMetadata('Fixture.Mismatch', '2.0')).toBeNull();
    expect(await db.releaseMetadata.count()).toBe(0);
  });
  it('does not expose unsafe or credential-bearing manifest links', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        'PackageIdentifier: Fixture.UnsafeUrl\nPackageVersion: "2.0"\nPackageUrl: javascript:alert(1)\nReleaseNotesUrl: https://user:password@example.invalid/\n',
      ),
    );
    const result = await getMetadata('Fixture.UnsafeUrl', '2.0');
    expect(result?.officialUrl).toBeNull();
    expect(result?.changelogUrl).toBeNull();
  });
});
