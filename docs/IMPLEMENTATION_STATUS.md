# Implementation status

Last updated: 21 October 2026 (Europe/London).

## Implemented

Next.js/React/TypeScript dashboard with responsive sidebar/navigation, real API-driven statistics, inventory search/filter/sort/pagination/details, cached source release metadata, explicit update preview/approval, job details/history/audit filtering and CSV exports. Light/dark themes, Radix confirmation dialogs, loading/empty/error states and persisted retention settings.

Express/TypeScript API with Zod contracts, scrypt accounts, opaque expiring sessions, Origin/CSRF protection, owner scoping, rate limiting, security headers, hashed one-use pairing, revocable expiring agent credentials, persisted replay nonces, atomic job claiming/leases and audit history. PostgreSQL/Prisma schema, committed migrations, active-job uniqueness, transactional scan snapshots and maintenance/retention.

Windows PowerShell agent with signed project-local Microsoft.WinGet.Client, structured real discovery, official-source validation, strict operation/target allowlists, DPAPI/ACL credential storage, health/heartbeat, bounded retries/timeouts, per-device mutex, restricted WinGet upgrade invocation and exact post-update observation. Installer failures, cancellation, reboot, verification failure and interruption have distinct persisted outcomes. Lost operations are not requeued.

## Verified environment and checks

- Windows PowerShell 5.1; Node.js 24.15.0; PostgreSQL 18.6; WinGet 1.29.380.
- No proposal PDF was present. No Docker executable was present; existing PostgreSQL binaries successfully initialized an isolated `.local/postgres` cluster on loopback port 55432.
- Prisma client generation and both migrations successfully applied to main and isolated test databases.
- Frontend and backend TypeScript checks passed.
- Frontend optimized production build and backend TypeScript build passed.
- Vitest: 37/37 domain, real PostgreSQL API, database-unavailable and mocked-source metadata persistence checks passed.
- PowerShell: 25/25 allowlist, injection/source/target validation, exit-code, exact argument and syntax checks passed. No real installer was invoked by these tests.
- Real read-only structured discovery returned 168 installed packages, including 22 source-supported update candidates, 19 exact current/source version matches, 115 unmatched packages and 12 with unavailable metadata. These are observations from this machine and can change; they are not seeded into main runtime data.
- Dependency audit: zero known vulnerabilities after updating Vitest and patched Prisma transitive overrides.
- Live source metadata fetch succeeded for the actually discovered `Git.Git` target `2.55.0.5`, including publisher, official website and changelog link. The genuine metadata cache is separate from inventory; no application/scan records were seeded into the main workspace.
- Playwright: 2/2 browser workflows passed. The fixture workflow exercised explicit pairing, scan, inventory, update review/approval, exact-version verification, history, security coverage, theme and mobile navigation. The real Windows workflow exercised the actual polling agent, one-use pairing, DPAPI/ACL storage, structured WinGet scan, database snapshots and displayed inventory counts. It never queued an UPDATE operation.
- Axe accessibility checks passed on the tested overview and approval dialog after fixing text contrast and loading-state ARIA. Desktop/mobile screenshots were visually inspected. This is limited automated coverage, not a full WCAG certification.
- Project-local PostgreSQL stop/start was exercised successfully. The cluster is separate from existing PostgreSQL services and databases.
- Normal `npm run dev` startup was checked against the main workspace: frontend returned HTTP 200 at `http://localhost:3000` and `/api/health` returned `ready` with PostgreSQL connected. Frontend/API are left running for handover. Create your own account with `npm run user:create`; main inventory remains empty until you explicitly pair and scan.
- Final ESLint/Prettier checks and rebuilt backend passed. Optimized frontend build, both TypeScript checks and the dependency audit passed; no known dependency vulnerabilities were reported.
- Initial browser checks exposed and resolved a frontend port conflict, selected-device persistence across navigation, a Windows SID ACL syntax issue, and accessibility violations. No failing integration was replaced with invented success data.

## Incomplete or deliberately unavailable

- **Real software upgrade is not tested or authorized.** No installed application was upgraded. Live publisher installer, UAC, Windows reboot and post-upgrade behavior remain a deliberate VM/manual acceptance step.
- Reliable vulnerability database matching, advisory severity/range validation and live findings are unavailable; the UI states this explicitly.
- Scheduled/background scans, bulk/automatic upgrades, notification preferences, Windows service hosting, account recovery and silent credential rotation are not implemented. Approval cannot be disabled; renewal is explicit re-pairing.
- English source manifest coverage is partial. Publisher/release date/changelog fields are absent when not reliably available.
- Broader platform/source/publisher coverage, signed agent distribution, independent penetration testing, backup/restore exercises and comprehensive WCAG 2.2 AA assessment remain future work.
- CI workflow is supplied but has not been executed on GitHub. The operator account creation CLI is supplied; no main-workspace account with default credentials is seeded. All browser fixture accounts and real scan verification data are isolated in `updatepilot_test`.

## Known operational limits

An installer may outlive a stopped/timed-out worker, and cannot be safely rolled back or forcibly cancelled by the dashboard. The application invalidates update eligibility after interruption and requires a fresh scan/new approval. Confirm an old installer has stopped before retrying. Elevation-only, ambiguous, pinned and nonstandard-version packages may fail safely or require separate handling. Source metadata and package catalogs may be stale/unavailable; those states remain explicit. The foreground agent must stay running and should be restarted after prerequisite/source health changes.

## Exact next steps

1. Provision your real account (`npm run user:create`), start dev servers, pair and scan through the normal interactive flow described in README.
2. Only with separate deliberate authorization, run a selected update in a disposable Windows VM and document actual installer, denied-elevation, disconnect, timeout and reboot outcomes. Full live update acceptance is not yet certified.
3. Add reliable advisory mappings and affected-range validation before enabling vulnerability findings.
4. For production use, complete independent security/accessibility review, backup/restore testing, signed agent packaging, account recovery and service lifecycle work.
