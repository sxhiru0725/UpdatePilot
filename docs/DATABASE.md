# Database and migrations

PostgreSQL/Prisma schema: `database/prisma/schema.prisma`. Run `npm run db:generate` after schema changes and `npm run db:migrate` to apply committed migrations. The initial SQL is generated from the actual Prisma model; a second migration adds the PostgreSQL partial unique index for one active job per device. Prisma cannot express that partial index directly; keep its SQL migration.

The third migration makes release channel nullable and clears previously inferred `stable` values. The manifest parser does not establish a channel reliably, so unknown must be stored and displayed as unknown rather than invented. All three migrations were applied to the local main and test databases during the assessment.

| Model                       | Purpose                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| User, Session               | Local account identity, scrypt password hash, expiring hashed session/CSRF credentials, retention preference                          |
| Device                      | Owner, Windows identity summary, health, versions, last-seen and revocation                                                           |
| Pairing                     | Hashed one-use pairing code with expiry and consumption timestamp                                                                     |
| AgentCredential, AgentNonce | Hashed device credential, expiry/revocation metadata, scoped replay ledger                                                            |
| Application                 | Latest observed software identity, versions, source, support/update state and current presence                                        |
| ReleaseMetadata             | Cached package/version/source manifest metadata, publisher, links, optional notes/date/channel                                        |
| UpdateApproval              | User/application/version/observation-bound one-use approval and expiry                                                                |
| Job                         | Both scan and update jobs, kind/state, initiator/device/application, exact versions, lease, timestamps, exit and verification outcome |
| ScanSnapshot                | Per-scan observed version and structured metadata; linked to job and application                                                      |
| AuditEvent                  | Owner/actor, device, event type, target, safe metadata and timestamp                                                                  |
| SecurityFinding             | Reserved schema for verified future advisory matching; runtime coverage is unavailable                                                |

UUID primary keys avoid predictable IDs. Foreign keys preserve owners of historical jobs; deleting a user/device with retained jobs is restricted. Sessions/credential nonces cascade with their owning identity; job deletion cascades its snapshots. Applications are marked absent, not deleted on each scan. Unique device/application identities support stable current records; package/version/source caches are unique. Device/status, owner/date and snapshot/job indexes support inventory and history queries.

The shared Job table deliberately replaces separate scan/update tables so claiming, leases, cancellation, interruption and history have one consistent state machine. `kind` discriminates payloads; API/agent validation restricts applicable fields.

## Safe changes

For a schema change, generate and review a new migration on a development database with `npx prisma migrate dev --schema database/prisma/schema.prisma --name <name>`. Back up valuable data before applying migrations. Never use `migrate reset` against a database with user data. `migrate deploy` applies migrations without creating a shadow database or dropping the database. Do not regenerate or rewrite migrations that have been applied elsewhere.

`db:local` creates only this repository's `.local/postgres` cluster and `updatepilot` database. `test:integration`/`test:e2e` additionally provision the explicitly named `updatepilot_test` database and guard against truncating the main database. Fixture records are never inserted in the real workspace.

Daily retention removes terminal jobs (and their scan snapshots) and audit events older than the owning user's chosen period. Pending/active jobs are never pruned by retention; lease/queue recovery handles them separately. Expired sessions/pairings/approvals and replay records older than ten minutes are cleaned by the 30-second worker. Current inventory, devices and credential revocation records remain until an explicit future deletion workflow.

Database backup/restore and migration rollback should be evaluated independently before using this MVP for valuable operational records.
