# UpdatePilot

A local Windows software inventory and manually approved update platform. Next.js + Express + PostgreSQL/Prisma + a PowerShell/WinGet agent. No paid services and no mandatory cloud hosting.

**Status:** implemented local MVP with verified real Windows discovery, pairing and PostgreSQL persistence. Real installation remains a separately authorized manual acceptance test. See [TEST_REPORT](TEST_REPORT.md) for the assessment against the 11-page `UpdatePilot_Project_Proposal.pdf` found in Downloads, and [implementation status](docs/IMPLEMENTATION_STATUS.md) for scope. Full proposal acceptance has not been achieved.

## What it does

- Reads structured installed-package objects from Microsoft's signed `Microsoft.WinGet.Client` module. Never parses console tables or guesses package IDs.
- Persists current inventory, immutable per-scan observations, device health, jobs, approvals and audit records.
- Separates confirmed updates, confirmed current packages, unknown versions, unsupported applications and unavailable metadata.
- Provides searchable/paginated inventory, application details and cached release notes from the official WinGet manifest repository.
- Requires a fresh scan and an explicit, short-lived, exact-version approval for every update. The agent independently revalidates the source, identity, installed version and target.
- Calls only the restricted `winget upgrade` argument vector. Keeps normal installer hash/signature checks enabled. Does not elevate itself, reboot Windows, perform bulk upgrades, or retry installers automatically.
- Verifies the installed version after an installer finishes. An exit code alone cannot produce a completed update.
- Includes job/audit history, CSV exports, revocation, history retention, responsive layouts and light/dark themes.
- States vulnerability matching coverage as **unavailable**; does not fabricate findings or claim software is secure.

## Requirements

Windows 10/11 with Windows PowerShell 5.1, current App Installer/WinGet, Node.js 24 LTS, npm, and PostgreSQL (tested with 18). Use a normal Windows user account. Some publisher installers require elevation; UpdatePilot never grants it automatically. Interactive/elevated-only packages may fail and remain unsupported in practice.

On other operating systems the web/API and mocked tests run, but the real agent requires Windows. PostgreSQL can also run in Docker; Docker is optional and was not installed on the development machine.

## First setup

Run commands from this repository root:

```powershell
npm ci
npm run db:local
npm run db:generate
npm run db:migrate
npm run user:create
npm run agent:setup
```

`db:local` uses the existing PostgreSQL binaries to initialize a **separate, project-owned** cluster in ignored `.local/postgres`, listening only on `127.0.0.1:55432`. It creates a random password and writes ignored `.env`. It does not modify existing databases or install a Windows service. No administrator permission is required. Set `POSTGRES_BIN` if binaries are elsewhere. `npm run db:stop` stops only this cluster.

`user:create` prompts for your email and a password of at least 12 characters; password input is hidden. Accounts cannot be registered through the unauthenticated public API. There are no default credentials or production sample records.

`agent:setup` downloads pinned `Microsoft.WinGet.Client` 1.29.380 to `.local/modules`, verifies the Microsoft Authenticode signature, and does not install or update any system application. The module dependency is project-local. If source agreements have not already been accepted in WinGet, review them yourself; UpdatePilot does not silently accept new source trust.

On this already configured computer, dependency installation is unnecessary. Use `npm run agent:check` to verify the cached module without downloading anything. The agent rechecks the primary Microsoft binary signature whenever it imports the module. `npm run agent:scan:check` performs read-only discovery and compares observations with fresh structured WinGet results plus selected `winget list` output; it never queues or executes updates. Fresh-machine dependency downloads (`npm ci`, `agent:setup` and `test:browser`) are setup actions requiring your permission during an assessment.

Recent npm versions may block dependency install scripts. `npm run db:generate` explicitly generates Prisma's client/engines. The project does not need Scarf telemetry. Do not globally enable every install script as a workaround.

### Existing PostgreSQL or Docker instead

Copy `.env.example` to `.env`, replace `DATABASE_URL` with a dedicated database you own, and run `db:generate` and `db:migrate`. The API always loads the root `.env`, including when npm runs in the backend workspace. Do not commit `.env`.

For Docker, set a random `POSTGRES_PASSWORD` in your shell, run `docker compose up -d`, and set the matching URL in `.env`. Do not run the project-local cluster and Docker on the same port.

## Start the application

```powershell
npm run dev
```

Or run in separate terminals:

```powershell
npm run dev:backend
npm run dev:frontend
```

Open **http://localhost:3000**. The API binds only to **127.0.0.1:4310**. Use exactly `localhost:3000` in the browser; the Origin/CSRF policy intentionally rejects other origins. `PORT=4310` is the supported agent/API port. The frontend explicitly uses port 3000 so root environment settings cannot accidentally move it.

Production build commands, for local evaluation:

```powershell
npm run build
npm run start -w backend
npm run start -w frontend
```

For cloud hosting, follow [the deployment guide](docs/DEPLOYMENT.md): Vercel hosts Next.js, a separate long-running Express service uses managed PostgreSQL, and the Windows agent connects outbound over HTTPS. The included Render blueprint selects the Free plan. Provider accounts, secrets, cloud deployment and live acceptance remain operator steps; this does not claim a hardened or already deployed production service. Local commands above remain supported.

## Pair and scan a real Windows device

1. Sign in, open **Settings & agent**, and click **Generate pairing code**. This is the explicit pairing approval; the code is single-use and expires in five minutes.
2. In another terminal in this project, run `npm run agent` and paste the code when prompted. The agent stores its credential in `%LOCALAPPDATA%/UpdatePilot/credential.xml` using user/machine-bound Windows DPAPI and a restricted directory ACL.
3. Keep the agent terminal open. Select the paired device from the top bar. It must show online and health `Ready`.
4. Click **Scan device**. The API queues the scan; the agent claims it, reads WinGet's structured package catalog, and submits a complete snapshot transaction.
5. Open **Applications** or **Updates**. Inventory and status refresh every ten seconds. Missing source data is never counted as up to date.

To re-pair after revocation/credential expiry:

```powershell
npm run agent -- -Pair
```

Paired credentials expire after 90 days; this MVP renews access by re-pairing instead of silently rotating a permanent token. A revoked device's history remains available. The UI refuses revocation while an operation is running, since revocation cannot stop an installer safely.

## Safely evaluate a real update

Automated tests **never update installed applications**. Only perform this step after deliberately choosing and authorizing a package:

1. Use a disposable Windows VM where possible. Save work and close the application.
2. Run a fresh scan. Select a supported update and click **Review**.
3. Check the exact package ID, current/target versions and WinGet source. Review publisher release notes and installer terms where available. Approving authorizes acceptance of that package's installer agreements, not new source trust.
4. Click **Approve & update** only when you authorize that installation. There is no automatic bulk update.
5. Follow **History → Details**. `Completed` requires exit code zero **and** a new installed version exactly matching the approved target. Reboot requirements, failed verification and interruptions remain distinct outcomes.
6. Run another inventory scan after completion. If an operation times out or disconnects, check whether the publisher installer is still running before rescanning/retrying. A timed-out installer can outlive the worker; UpdatePilot never assumes it was rolled back.

No actual upgrade was authorized during development. Therefore live installation, actual UAC behavior and real reboot behavior are not certified by the automated checks.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:agent
npm run agent:check
npm run agent:scan:check
npm run test:e2e
npm run build
npm audit
```

`npm test` runs unit tests and skips database API tests unless `TEST_DATABASE_URL` is set. `test:integration` creates/migrates the **separate `updatepilot_test` database** on your configured local PostgreSQL and runs all API/unit tests. Its API suite intentionally truncates that test database; the runner and tests refuse the main database name. Do not use a database containing valuable data for tests.

`test:browser` downloads a headless Chromium **test dependency** into `.local/browsers` only when it is missing and you authorize setup. It is already present on the assessed computer. `test:e2e` launches its own frontend/API on ports 3001/4311 with a separate `.next-e2e` directory and the isolated test database. Normal development servers can stay running. Run database integration and browser suites sequentially because they share the disposable test database. Three browser tests cover dashboard controls/negative states, a fixture update through the agent API, and the actual Windows agent performing a read-only scan. The real-agent test requires Windows and the signed module; report any skip explicitly. Synthetic records stay in the test database. Screenshots/traces are ignored in `test-results`. Real inventory screenshots can include installed software names; do not publish them without review.

## Project map

```text
frontend/             Next.js App Router, React UI, API client, styles
backend/src/          Express API, authentication, agent protocol, jobs, metadata
backend/tests/        Domain/security and PostgreSQL API tests
database/prisma/      Prisma schema and versioned SQL migrations
agent/src/            Polling agent, restricted worker, structured discovery
agent/scripts/        Verified project-local module setup
agent/tests/          PowerShell validation and mocked operation checks
scripts/              Private PostgreSQL and isolated test/browser provisioning
tests/e2e/            Browser fixture workflow and real read-only agent workflow
docs/                 Architecture, security, database, API, agent, demo and status
```

## Troubleshooting and limits

- **Database unavailable:** run `npm run db:local`, verify `.env`, then `npm run db:migrate`. Port 55432 must be free. Set `POSTGRES_BIN` if automatic binary discovery fails. Never reset an unrelated cluster to resolve a startup error.
- **Sign-in/CSRF errors:** use `http://localhost:3000`, sign in again, and check `WEB_ORIGIN`. Sessions expire after eight hours. There is no email/password recovery service; local account provisioning is an operator command.
- **Agent unavailable:** keep its terminal open, run `agent:check`, and check the `winget` source exists at Microsoft's official cache URL. Use `agent:setup` only if the dependency is missing and you approve its download. The agent fails closed if the source has been replaced. Health checks happen at startup; restart the agent after fixing prerequisites.
- **Offline:** heartbeat older than 60 seconds. Claimed jobs lose their lease after 90 seconds without progress; the 30-second maintenance loop marks them interrupted. Queued jobs expire after 30 minutes.
- **Already active:** one queued/running/verifying operation per device is enforced by PostgreSQL. Wait or cancel a queued job in History.
- **No metadata/publisher:** publisher enrichment uses exact registry name/version matches; ambiguous or missing publisher fields remain unavailable. App details also try the exact English source manifest with a 24-hour cache and 15-minute failure backoff. No URL or package identity is guessed from an application name.
- **Installed version newer than source:** this remains unverified rather than being incorrectly called current. Versions are ordered by WinGet; nonstandard version strings are not assumed to be semantic versions.
- **Pinned, ambiguous, Store, elevation-only or unmatched packages:** may be excluded or fail safely. This is not a universal software updater or rollback tool.
- **Security coverage:** CVE/OSV matching, severity/range validation, background scans, desktop notifications, credential hot rotation and Windows-service hosting remain future work.

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [API](docs/API.md), [database](docs/DATABASE.md), [agent guide](docs/AGENT.md) and [testing/demo guide](docs/TESTING.md).
