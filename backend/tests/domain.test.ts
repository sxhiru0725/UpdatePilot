import { describe, it, expect } from 'vitest';
import { packageId, observation, compareVersions, scanResult } from '../src/contracts.js';
import { canTransition, updateOutcome } from '../src/services/jobs.js';
import { csvCell } from '../src/app.js';
import { passwordHash, verifyPassword } from '../src/security.js';

describe('conservative package intelligence', () => {
  it('compares numeric segments without lexical or floating point errors', () => {
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.0.0', '1')).toBe(0);
    expect(compareVersions('99999999999999999999', '2')).toBe(1);
    expect(compareVersions('2', '10')).toBe(-1);
  });
  it.each(['v1.2', '2025 beta', 'unknown', '1.2-rc1', '1,2'])(
    'does not guess ordering for %s',
    (v) => {
      expect(compareVersions(v, '2')).toBeNull();
    },
  );
  it.each(['Vendor.App; whoami', '--all', 'Vendor.App$(id)', 'Vendor/App', 'Vendor.App\n--force'])(
    'rejects command injection identity %s',
    (v) => {
      expect(packageId.safeParse(v).success).toBe(false);
    },
  );
  it('accepts exact package identities', () => {
    expect(packageId.parse('Microsoft.VisualStudioCode')).toBe('Microsoft.VisualStudioCode');
    expect(packageId.safeParse('Vendor.App\n').success).toBe(false);
  });
  it('requires source identity and known versions to claim currency', () => {
    const app = {
      identity: 'winget|Vendor.App',
      name: 'App',
      publisher: null,
      installedVersion: 'Unknown',
      availableVersion: null,
      packageId: null,
      source: null,
      status: 'UP_TO_DATE',
    };
    expect(observation.safeParse(app).success).toBe(false);
    expect(observation.safeParse({ ...app, status: 'UNMATCHED' }).success).toBe(true);
  });
  it('rejects duplicate observation identities', () => {
    const a = {
      identity: 'same',
      name: 'App',
      publisher: null,
      installedVersion: '1',
      availableVersion: null,
      packageId: null,
      source: null,
      status: 'UNMATCHED',
    };
    expect(
      scanResult.safeParse({ lease: 'a'.repeat(64), status: 'COMPLETED', applications: [a, a] })
        .success,
    ).toBe(false);
  });
  it('never labels a mismatched source version as current', () => {
    expect(
      observation.safeParse({
        identity: 'winget|Vendor.App',
        name: 'App',
        publisher: null,
        installedVersion: '2',
        availableVersion: '1',
        packageId: 'Vendor.App',
        source: 'winget',
        status: 'UP_TO_DATE',
      }).success,
    ).toBe(false);
  });
});
describe('safe outcomes', () => {
  const result = {
    lease: 'a'.repeat(64),
    outcome: 'FINISHED' as const,
    packageId: 'Vendor.App',
    source: 'winget' as const,
    resultingVersion: '2',
    exitCode: 0,
  };
  const job = { targetVersion: '2', previousVersion: '1', status: 'VERIFYING' as const };
  it('requires exact post-update version and verification phase', () => {
    expect(updateOutcome(result, job)).toEqual({ status: 'COMPLETED', verified: true });
    expect(updateOutcome({ ...result, resultingVersion: '1' }, job).status).toBe(
      'VERIFICATION_FAILED',
    );
    expect(updateOutcome(result, { ...job, status: 'RUNNING' }).status).toBe('VERIFICATION_FAILED');
  });
  it('never treats a failed installer or reboot request as completed', () => {
    expect(updateOutcome({ ...result, exitCode: 1 }, job).status).toBe('FAILED');
    expect(
      updateOutcome({ ...result, outcome: 'RESTART_REQUIRED', exitCode: 3010 }, job).status,
    ).toBe('RESTART_REQUIRED');
  });
  it('rejects terminal-state replay and reversal', () => {
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('VERIFYING', 'RUNNING')).toBe(false);
    expect(canTransition('RUNNING', 'VERIFYING')).toBe(true);
  });
  it('neutralizes spreadsheet formula injection and quotes', () => {
    expect(csvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('  =1')).toBe('"\'  =1"');
    expect(csvCell('\n=1')).toBe('"\'\n=1"');
  });
  it('salts password hashes and verifies safely', () => {
    const stored = passwordHash('strong testing password');
    expect(stored).not.toBe(passwordHash('strong testing password'));
    expect(verifyPassword('strong testing password', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });
});
