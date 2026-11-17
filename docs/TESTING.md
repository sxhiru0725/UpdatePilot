# Tests and local demonstration

## Automated checks

`npm run test:integration` provisions/migrates the local `updatepilot_test` database, then runs Vitest unit/API tests against actual PostgreSQL. The test database name is guarded before truncation. Tests cover conservative version comparison, input/command injection, job transitions, password hashing, CSV formula injection, authentication/Origin/CSRF, ownership, one-use/expired pairing, nonce replay, hashed credentials, duplicate jobs, atomic snapshots, approval binding, verification/failure, expired leases, offline behavior, cancellation, revocation, export and unavailable security coverage.

`npm run test:agent` uses PowerShell assertions and module-local mocks. It checks strict operation/source/version allowlists, cached signature validation, structured inventory classifications, stale/missing target rejection, exact WinGet arguments, native stderr/exit codes and script syntax. It also executes the actual worker with import, installer, observation and sleep boundaries replaced by local fixtures, checking bounded verification, unchanged versions, failure, cancellation and reboot codes. Mocked commands never invoke a real installer. The API separately decides completion from the worker's reported exit code, phase and observed version.

`npm run test:browser` downloads a headless Chromium dependency under `.local/browsers`; it is unnecessary on the configured assessment computer. `npm run test:e2e` starts fresh API/frontend processes on 4311/3001 with `.next-e2e` against the isolated test database, leaving normal dev servers available. Run integration and browser suites sequentially. Three tests cover dashboard controls (exports, filters, cancellation, persisted settings, offline/failure/timeout/revocation), the fixture update approval/result protocol, and the actual signed module/PowerShell worker for read-only inventory and reconnection. The fixture workflow also checks stale-response protection and missing saved-device recovery. The real test checks actual snapshots/counts, isolated DPAPI storage and nonzero exit after revocation. Windows/module prerequisites determine whether that real test runs or is skipped; a skipped check must not be claimed as successful integration.

`npm run typecheck` checks frontend, backend and test/script TypeScript. `npm run lint`, `npm run build` and `npm audit` provide separate quality/build/dependency checks. `npm run agent:check` revalidates the cached module with no download; `npm run agent:scan:check` compares real read-only inventory against structured WinGet and selected CLI list output. Generated `next-env.d.ts` is owned by Next.js and excluded from formatting. Pinned Prisma v6 is used deliberately with patched transitive `effect` and `deepmerge-ts` overrides; validate generation/migrations and the audit when changing those dependencies.

See [TEST_REPORT](../TEST_REPORT.md) for the exact checks, failures and results from this assessment. Passing mocks does not prove real installer/elevation/reboot behavior. CLI arguments are forwarded, for example `npm run test:e2e -- --grep 'dashboard pages'` or `npm run test:integration -- --reporter=verbose`.

## Read-only demo

1. Follow README setup; sign in using your locally provisioned account.
2. Show the empty-state dashboard and explicit vulnerability coverage limitation.
3. Generate a pairing code, run the normal agent, and verify online/ready status.
4. Select the device and scan. Show real inventory counts, unsupported/unmatched states and available updates.
5. Search inventory, filter status, open details/release metadata and download inventory CSV.
6. Open an update preview and review exact identity/current/target/source. **Cancel** to keep the demo read-only.
7. Inspect the scan's persisted history, detected count, actor and timestamps. Stop the agent and wait over 60 seconds to demonstrate offline status.
8. Restart the agent, verify reconnection, then revoke the idle device if you wish to demonstrate credential invalidation.

## Deliberately authorized installation test

Use a disposable Windows VM with a chosen supported outdated package. Take a VM snapshot. Pair, scan and review the exact package. Explicitly authorize only that installation by clicking Approve. Check `RUNNING`, `VERIFYING` and terminal outcome, exact post-update version, initiator, duration, exit code and audit trail. Rescan afterward. Also deliberately test denied elevation, publisher failure, network loss and reboot requirements in that VM. Do not assert success on exit code alone or run upgrades on the development computer as part of automated testing.

No real upgrade is performed by the automated commands. The UI confirmation is a real action when a genuine agent is connected, not a simulated demonstration button.
