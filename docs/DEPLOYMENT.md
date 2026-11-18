# Deploy UpdatePilot online

## Root cause and deployment boundary

The initial browser request is `GET /api/v1/auth/me`, from `frontend/components/workspace.tsx` through `frontend/lib/api.ts`. Previously `response.json()` caught HTML/empty responses and substituted `The server returned an unreadable response.` It even returned that error object as successful data when the HTTP status was 200. This hid the actual deployment problem.

Only the frontend was deployed. The Next.js rewrite defaulted to `http://127.0.0.1:4310`; on Vercel that address belongs to Vercel's runtime, not the user's computer. No Express process or PostgreSQL database was deployed with the frontend. Express also rejected non-loopback web origins and bound exclusively to loopback. The agent rejected remote URLs. Setting a browser API URL alone could not make this architecture work online.

The supplied public URL currently redirects unauthenticated requests to Vercel SSO (HTTP 302). Following that redirect returns HTML from Vercel, not UpdatePilot JSON. This prevents independent inspection of the old production application response. It does not establish whether an authenticated visitor received an HTML gateway error or another non-JSON response. The missing cloud backend/database is confirmed by the operator.

The implemented deployment is:

```text
Browser -> Vercel Next.js /api route -> HTTPS Express service -> managed PostgreSQL (TLS)
Local Windows agent ----------------> HTTPS Express service
```

Next.js uses a Node.js Route Handler to proxy `/api/*`. There is no browser-visible backend URL or cross-site session cookie. `API_URL` is read server-side at runtime; Vercel cannot fall back to loopback. Missing/invalid configuration returns JSON 503; connectivity errors, redirects and non-JSON API responses return safe JSON 502/504. The client validates content type, JSON, status and the `data` envelope. It never invents successful data.

Use a **long-running backend service**, not a static site or an unchanged Express server wrapped in a Vercel Function: `backend/src/server.ts` runs 30-second maintenance and daily retention work. Serverless invocation lifetime does not provide this continuous lifecycle. Porting Express to serverless would also require reliable scheduled maintenance and a shared rate-limit store. Next.js Route Handlers are supported by [Vercel Functions](https://vercel.com/docs/functions).

## Hosting choice and free-tier limits

The included `render.yaml` creates **one Render Free Node web service** and no paid database or other paid resources. Create PostgreSQL separately on **Neon Free**. Both provide managed TLS. No provider accounts or resources have been created by this change.

- [Render Free](https://render.com/docs/free): 750 free instance hours per workspace each month; idle services sleep after 15 minutes and can take about a minute to wake. Warm `/api/health` directly and retry the dashboard after a cold start. Do not use Render's temporary Free PostgreSQL for persistent production data: it expires after 30 days.
- [Neon Free](https://neon.com/pricing): currently 100 CU-hours monthly and 1 GB storage per project, with no credit card required. These limits are suitable for a small evaluation, **not a guarantee of continuous production service**. Agent polling and the backend's maintenance queries keep database compute active; at 0.25 CU, 100 CU-hours is about 400 active hours. Watch the provider's usage dashboard. Stop the evaluation backend when unused or obtain approval for a paid upgrade; do not silently enable paid usage.
- Alternative: use an existing managed PostgreSQL provider with TLS. [Supabase Free](https://supabase.com/pricing) is another option; use its documented Prisma-compatible connection/pooler settings. Its configuration has not been exercised here. Moving to always-on paid hosting, higher database capacity or multi-instance scaling requires separate cost approval.

Provider quotas and prices can change; review the linked pages before provisioning. A free deployment can pause, exhaust quota or return transient errors. For dependable always-on operation, budget approval and monitoring/backup arrangements remain necessary.

## 1. Create managed PostgreSQL

1. Create a Neon account and select the **Free** plan. Create a dedicated UpdatePilot project/database; choose Frankfurt if available, near the backend. Keep it separate from the local PostgreSQL cluster.
2. In **Connect**, copy the connection string with pooling enabled and the direct/unpooled connection string for the **same database and role**. Keep both private. Do not paste them into chat, source files or Git.
3. Preserve the provider's TLS parameters (`sslmode=require` or `sslmode=verify-full`). For this project's pinned **Prisma 6.19**, add `connection_limit=3&connect_timeout=10&pool_timeout=10` to the pooled URL, using `&` when a query already exists. Do not upgrade Prisma as part of deployment. See [Prisma 6 Neon integration](https://www.prisma.io/docs/orm/v6/overview/databases/neon).
4. Store the pooled URL as `DATABASE_URL` and the unpooled URL as `DIRECT_DATABASE_URL` in the backend hosting environment. Both are secrets. Percent-encode any manually constructed username/password components; prefer copying provider-generated strings.

The existing three migrations in `database/prisma/migrations` create the application schema, including job serialization. `npm run start:production` runs **`prisma migrate deploy`** against the direct URL, stops on any failure, then starts the compiled Express server against the pooled URL. It never runs `db push`, `migrate reset`, development migrations, seeds or mock data. `npm run db:migrate:production` applies migrations alone when the same production environment variables are present. Back up a populated cloud database before future schema changes.

A new database starts empty. Local users, devices and inventory are not automatically copied. Provision a cloud account and pair explicitly. If existing data must be transferred, plan a separate PostgreSQL backup/restore with private credentials, maintenance time and validation; do not run tests against that data.

## 2. Deploy Express on Render

1. Push these reviewed changes to `sxhiru0725/UpdatePilot` on the branch you will deploy.
2. Create a Render account. Choose **New > Blueprint**, connect the repository and select the deployment branch. Render reads root `render.yaml` and prompts for the two database secrets. Confirm that the service plan is **Free** before creating it. No paid resource is required by this blueprint.
3. If creating a Web Service manually, use these exact settings:

| Setting        | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Repository     | `sxhiru0725/UpdatePilot`                                                  |
| Root directory | Repository root (leave blank)                                             |
| Runtime        | Node                                                                      |
| Region         | Frankfurt, or near your database                                          |
| Instance plan  | Free                                                                      |
| Build command  | `npm ci --include=dev && npm run db:generate && npm run build -w backend` |
| Start command  | `npm run start:production`                                                |
| Health check   | `/api/health`                                                             |
| Instance count | One                                                                       |

Set the following **only on the backend**:

| Variable              | Required value                                                     |
| --------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`        | Secret pooled PostgreSQL URL with TLS, as above                    |
| `DIRECT_DATABASE_URL` | Secret direct PostgreSQL URL with TLS to the same database         |
| `WEB_ORIGIN`          | `https://frontend-sxhiru.vercel.app` (no trailing slash)           |
| `NODE_ENV`            | `production`                                                       |
| `HOST`                | `0.0.0.0`                                                          |
| `TRUST_PROXY_HOPS`    | `1` for the Render ingress proxy; use `0` for direct local hosting |
| `NODE_VERSION`        | `24.15.0`                                                          |
| `PORT`                | Use Render's injected port; do not override it                     |

4. Wait for migration success and a healthy service. Record its actual HTTPS origin, e.g. `https://updatepilot-api-UNIQUE.onrender.com`; the blueprint name does not guarantee that exact hostname.
5. Open `https://YOUR-BACKEND/api/health`: expect HTTP 200, JSON `{"status":"ready","database":"connected"}`. Open `/api/v1/auth/me` without a session: expect **HTTP 401 JSON** `{"error":"Sign in to continue"}`. This is correct authentication behavior. A 503 from health means the database cannot be reached; inspect connection settings, provider availability and migrations.

The cloud service is intentionally reachable over HTTPS, including its authenticated agent endpoints. Do not put browser SSO/deployment protection in front of these endpoints: a Windows agent cannot complete an interactive browser login. App sessions, CSRF, pairing and bearer credentials remain mandatory. Do not expose PostgreSQL on your home network or open any inbound Windows agent port.

Render adds its own client IP before Express; only that last hop is trusted. The Next.js proxy strips supplied forwarding headers. Browser requests share the gateway's upstream IP for the existing IP-based limits; direct agent requests use their own ingress client IP. Keep one backend instance for the existing in-memory rate limiter. A larger fleet needs reviewed client identity propagation and a shared limiter; do not broadly set `trust proxy=true` to bypass it. See [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/).

## 3. Configure Vercel frontend

| Setting                                     | Value                                                             |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Framework preset                            | Next.js                                                           |
| Root Directory                              | `frontend`                                                        |
| Include source files outside Root Directory | Enabled (workspace root lockfile and shared TypeScript config)    |
| Node.js version                             | 24.x                                                              |
| Install command                             | `cd .. && npm ci --include=dev`                                   |
| Build command                               | `npm run build` (runs in `frontend`, not the root combined build) |
| Output directory                            | Next.js default; clear custom overrides                           |
| Environment, Production                     | `API_URL=https://YOUR-ACTUAL-BACKEND-HOST`                        |

`API_URL` is an **origin only**: no `/api`, `/api/v1`, query parameters or credentials. Do not use the frontend's own URL, localhost, your Windows IP, or a `NEXT_PUBLIC_*` database/backend secret. No database URL, session signing key or agent credential belongs in Vercel. Sessions already use random tokens with hashed database storage; there is no missing JWT/session signing secret to invent.

Redeploy after saving settings so Vercel applies the new route/configuration. Remove any dashboard-level `/api` rewrites or SPA catch-all overrides that bypass the Next.js Route Handler. Do not choose static export or serve only a generated static directory: `/api` needs the Node.js function. If deployment protection is enabled on the frontend, sign in through Vercel as usual before verifying the app; no app-authentication bypass is required. The agent targets Render directly and does not require a Vercel protection bypass key.

Preview deployments have different browser Origins. Do **not** widen production CORS or disable CSRF for previews. Use a separate backend/database with `WEB_ORIGIN` set to the exact preview domain, or leave previews without API access. `API_URL` can be set independently by Vercel environment.

After deployment, `/api/health` on the frontend must return the same JSON readiness response and `/api/v1/auth/me` without a session must return JSON 401. If you see HTML, check deployment protection, that the correct commit/root directory was deployed, and external routing overrides. JSON 503 mentioning `API_URL` means frontend configuration is missing. JSON 502/504 means the upstream is misconfigured, cold-starting or unreachable. The dashboard may need Retry after the free backend wakes.

## 4. Create a cloud account privately

After migrations succeed, run from your local repository root:

```powershell
powershell -NoProfile -File scripts/create-production-user.ps1
```

Paste the cloud connection string into the hidden prompt, then enter an email and a password of at least 12 characters. This uses the existing account provisioning CLI and creates an account **in the cloud database**. It temporarily sets process environment variables and restores them afterward; it does not edit local `.env`. Keep the terminal private. No default passwords, public registration or authentication bypass were added. If using a custom frontend domain, pass `-WebOrigin https://YOUR-FRONTEND-HOST` to the script.

Sign in at the frontend. HTTPS sessions use HttpOnly, Secure, SameSite Strict cookies. The separate CSRF cookie remains readable by the frontend and must match the authenticated session's stored hash. The proxy preserves the exact browser Origin and CSRF header, and forwards only UpdatePilot cookies. Login/logout preserve both separate `Set-Cookie` headers. API responses are `Cache-Control: no-store`.

## 5. Pair the local Windows agent to the cloud

The agent remains installed and executed on the Windows computer, using the normal signed WinGet module and current-user permissions. The existing transport is **outbound polling**, not an inbound server, remote desktop connection, cloud scan of localhost or arbitrary command runner.

1. Sign in to the cloud dashboard, open Settings & agent and generate a fresh five-minute pairing code.
2. In your local repository terminal run:

   ```powershell
   npm run agent -- -BackendUrl https://YOUR-ACTUAL-BACKEND-HOST -Pair
   ```

3. Paste the one-use code into the hidden prompt. Keep the terminal open. Use the **Render backend origin directly**, not the protected Vercel frontend. No port forwarding or Windows firewall inbound exception is needed.
4. Select the device after it reports Online/Ready, then explicitly queue a scan. Cloud inventory appears only after the real Windows agent completes that scan. This is the final live acceptance step; it cannot be verified before the cloud backend/database exist.

The transport extension accepts an explicitly selected HTTPS DNS hostname on port 443, uses normal certificate validation/TLS 1.2, and refuses redirects, URL credentials, non-root paths and plaintext remote HTTP. Existing fixed local HTTP ports remain available. Cloud credentials use a backend-specific directory below `%LOCALAPPDATA%/UpdatePilot`, are bound to that exact backend origin, and stay protected by DPAPI and restrictive ACLs. Legacy local credentials cannot be sent to a cloud backend. Use `-Pair` for explicit renewal/revocation. Do not pass bearer credentials on the command line.

Unchanged controls include one-use pairing, credential hashes/expiry/revocation, per-request timestamp/nonces, ownership checks, job leases, exact update approvals, restricted WinGet arguments, independent identity/version checks and post-install verification. Stopping the local agent makes the device Offline. Browser access cannot make an offline Windows computer scan itself.

Local operation remains `npm run dev`, `npm run agent`, `WEB_ORIGIN=http://localhost:3000`, `HOST=127.0.0.1`, PostgreSQL on loopback, and the default `http://127.0.0.1:4310` proxy target outside Vercel. Do not overwrite local `.env` with cloud secrets.

## Release verification

Run local checks against the isolated `updatepilot_test` database, never the cloud database:

```powershell
npm run db:local
npm run db:generate
npm run test:integration
npm run test:agent
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The new regression tests cover HTML responses (including HTTP 200), malformed JSON/envelopes, missing/unsafe cloud API URLs, redirects, gateway errors, cookie/CSRF forwarding, CSV downloads, real PostgreSQL readiness, HTTPS cookie flags, session invalidation, and Origin/CSRF rejection. Agent checks exercise endpoint validation and credential-origin binding without installing applications. See [deployment verification results](DEPLOYMENT_VERIFICATION.md) for what was actually run and what remains manual.

The code is prepared for hosting; the cloud resources, secrets, deployed URL, cloud account and live agent pairing still require the account-owner steps above. Independent security review, signed agent distribution, supervised service lifecycle, backups/recovery, monitoring and broad real-installer acceptance remain beyond this runtime fix. No online scan or real package update is claimed without a live acceptance run.

The dependency audit is also not clean: after updating Next.js to 16.4.6, `npm audit --omit=dev` still reports two high-severity advisories (Zod and body-parser). The full audit reports 14 affected packages (8 high, 6 moderate), including development-tool transitive dependencies. The optional parser upgrade encountered a Windows compatibility issue during verification and was omitted. Express instead rejects compressed request bodies before inflation, excluding the compressed-body path described by that advisory; all existing browser and agent requests send plain JSON. This mitigation does not clear the audit finding. The advertised Zod fix requires a major upgrade and compatibility work across backend contracts and frontend form validation. Review/remediate these findings before a broad public production release; the existing CI audit gate remains effective. This runtime fix does not apply `npm audit fix --force` or disable that gate.
