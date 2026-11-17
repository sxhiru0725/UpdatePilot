# Security model

## Browser and API

- User provisioning is a local operator CLI, with no unauthenticated registration route or default account.
- Passwords use a per-password random salt and Node scrypt; comparisons use constant-time verification. Sessions are random 256-bit opaque tokens, stored only as SHA-256 hashes in PostgreSQL, expire in eight hours and can be invalidated by logout.
- The session cookie is HttpOnly and SameSite Strict. Production uses Secure cookies. A separate CSRF cookie must match the hash bound to the authenticated session, and browser mutations require the configured exact Origin. CORS allows only that origin; API and database bind to loopback.
- Every device, application, job and export is scoped to the authenticated owner. Unknown or unowned object IDs receive 404. Package/operation bodies reject unexpected properties.
- Helmet and frontend security headers reduce browser exposure. API logs omit tokens, cookies, bodies and installer output. Errors expose safe explanations rather than database connection strings or stack traces. Login/pairing failures and overall API traffic have rate limits.
- CSV fields are quoted and leading formula characters neutralized. Manifest links require HTTPS and cannot contain credentials. Manifest fetches use fixed Microsoft repository paths; application-supplied arbitrary URLs are never fetched by the server.

## Pairing protocol

1. An authenticated owner explicitly requests a pairing code in Settings. The API generates 256 random bits, stores its hash and a five-minute expiry, and records the approval audit event.
2. The user supplies the code directly to the local agent. Pairing accepts no browser Origin header and exchanges the code atomically once; expiration, reuse and invalid codes are rejected.
3. The API registers the device under that owner and returns a separate 256-bit agent credential. Only its SHA-256 hash is persisted server-side. Its lifetime is 90 days; renewal is explicit re-pairing. There is no permanent unrestricted token.
4. The agent stores its credential in a PSCredential using Windows DPAPI, bound to the current Windows user and machine. The directory ACL permits the current SID and SYSTEM. Tokens never appear in command-line arguments, source, normal logs or browser storage.
5. Each agent request includes the bearer credential, current Unix milliseconds and a new UUID. Requests outside a 60-second window and repeated credential/UUID pairs are rejected. Nonce records remain longer than the replay window. Credentials and devices are checked for revocation on every request.
6. Job execution has a separate hashed, expiring lease. Claiming is atomic; progress/results require that exact lease, device and nonterminal state. Lost responses cannot authorize another execution. Revocation cancels queued jobs and blocks subsequent authentication; a running operation must finish first because revocation cannot safely reverse it.

HTTP on fixed loopback is an intentional local-only boundary. It is not transport security for a remote agent. Do not bind this design to an external network without a separate TLS and machine-identity design.

The normal API port is 4310; browser tests use a separate backend on 4311. The agent permits that test port only with an explicit isolated credential path. Cached module import revalidates the primary Microsoft cmdlets binary signature; this is a dependency check, not signed distribution of UpdatePilot or attestation of every module file.

## Installation restrictions

Only `SCAN` and `UPDATE` envelopes exist. No browser/API field contains a shell command, script body, executable name, installer argument overrides or arbitrary source. Update IDs and versions have bounded character allowlists. The agent verifies WinGet correlation by exact ID, trusted official source URL, installed version and available target. Unknown versions and ambiguous identities fail closed.

WinGet receives `upgrade --id <validated ID> --exact --source winget --version <approved version> --silent --disable-interactivity --accept-package-agreements` through a literal argument array. This accepts only the explicitly approved package's installer agreements. No `--force`, hash mismatch override, security check bypass, installer override, source trust override, elevation helper, automatic reboot or bulk switch is passed.

UpdatePilot runs as the current user and never uses `RunAs`. Some installers require Windows elevation; user approval must occur through Windows or the operation fails. Least-privilege operation does not guarantee every third-party installer supports silent/user-scope execution.

## Operational limits

This is not a protection boundary against malicious programs already running as the same Windows account; those programs can read that user's files, use DPAPI and access local services. Installer content and behavior remain governed by WinGet and the publisher. Post-update verification confirms the reported installed version, not a full security attestation or rollback capability.

Production readiness additionally needs independent security review, signed agent distribution, service lifecycle controls, backup/restore exercises, account recovery, verified hot credential rotation, and broader publisher/elevation/reboot integration testing. Vulnerability findings are unavailable until reliable ecosystem/package mapping and affected-range validation exist.

Credentials live only in ignored `.env`, protected DPAPI storage and test-only directories. Do not commit or publish `.local`, database files, traces or screenshots containing inventory. History retention defaults to 90 days, is configurable from 30–365 days, and applies daily to terminal jobs/snapshots and audit records. Current inventory and device identity are retained.
