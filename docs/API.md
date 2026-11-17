# API guide

Base URL: `http://127.0.0.1:4310/api/v1`, accessed by the browser through `http://localhost:3000/api/v1`. Authenticated OpenAPI JSON: `/api/v1/openapi.json`. Swagger UI: `/api/v1/docs/` (sign in first). The executable contract is generated in `backend/src/openapi.ts`; request schemas are Zod validated at runtime.

Success responses use `{ "data": ... }`, optionally `{ "pagination": { "page": 1, "limit": 25, "total": 0 } }`. Errors use `{ "error": "safe explanation" }`, with field-level validation details for HTTP 400. Codes include 200, 201 (pairing), 202 (queued operation), 400, 401, 403, 404, 409, 429 and 503. `/api/health` checks the actual database.

| Route                                        | Behavior                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| POST `/auth/login`                           | Validated email/password, sets session and CSRF cookies                      |
| GET `/auth/me`, POST `/auth/logout`          | Current identity / invalidate session                                        |
| GET `/dashboard?deviceId=`                   | Inventory aggregates, last scan, recent jobs, seven-day activity             |
| GET `/devices`                               | Owner-scoped device records and computed connection state                    |
| POST `/devices/pair`                         | Explicit owner approval, returns five-minute one-use code                    |
| POST `/devices/:id/revoke`                   | Requires `{confirm:true}`; revokes credentials, cancels queued work          |
| POST `/devices/:id/scans`                    | Queue scan on ready online device                                            |
| GET `/scans/:id`, GET `/jobs/:id`            | Owner-scoped job details without execution credentials                       |
| GET `/applications`                          | Search name/publisher, status/device filters, bounded pagination and sorting |
| GET `/applications/:id`                      | Details, cached metadata and recent update history                           |
| GET `/updates`                               | Current observations with reliable update evidence                           |
| POST `/updates/:id/preview`                  | Application ID, exact current/target/source and bound confirmation token     |
| POST `/updates/:id/execute`                  | Requires `{confirm:true,confirmationToken}`; consumes approval once          |
| POST `/jobs/:id/cancel`                      | Queued operations only; no false running-installer cancellation              |
| GET `/history`                               | Search, `type=SCAN/UPDATE/AUDIT`, status/device filter, page/limit/order     |
| GET `/security/findings`                     | Empty findings with explicit `coverage: UNAVAILABLE` explanation             |
| GET/PATCH `/settings`                        | Persist effective history retention, 30–365 days                             |
| GET `/exports/inventory`, `/exports/history` | Owner/device-scoped CSV, maximum 50,000 records                              |
| POST `/agent/pair`                           | Code exchange without browser Origin; returns separate device credential     |
| POST `/agent/heartbeat`                      | Authenticated health/version/last-seen report                                |
| POST `/agent/jobs/claim`                     | Atomic single claim; exact operation or null                                 |
| POST `/agent/jobs/:id/progress`              | Authenticated execution lease renewal; RUNNING/VERIFYING                     |
| POST `/agent/jobs/:id/scan-result`           | Complete validated atomic snapshot or explicit failure                       |
| POST `/agent/jobs/:id/update-result`         | Identity, observed version, exit/outcome; server computes success            |

Application list query: `page` starts at 1; `limit` 1–100; `sort=name|publisher|lastObserved`, `order=asc|desc`, `search`, `status` and optional UUID `deviceId`. Job history always uses creation date order; the frontend defaults to newest first.

Browser mutations require the exact configured `Origin` and `X-CSRF-Token` matching the readable `up_csrf` cookie/session hash. Do not use session credentials for agent routes. Every agent request except pairing requires `Authorization: Bearer <credential>`, `X-Request-ID: <new UUID>` and `X-Agent-Timestamp: <Unix milliseconds>`. The timestamp must be within 60 seconds and the UUID cannot repeat for that credential. Job callbacks additionally include the exact execution `lease` in the JSON body. These secrets are deliberately absent from browser history/job responses.
