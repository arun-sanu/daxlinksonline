# DaxLinks Backend (Pendax trading ingress)

This directory contains the backend API for DaxLinksOnline — a Pendax-based TradingView webhook ingress and forwarding control plane.

Overview:

- Receives host-based webhooks from TradingView (or other sources) and maps them to workspace users.
- Normalizes alerts and forwards them via Pendax exchange connectors or user-supplied trading bots in real-time.
- Manages workspaces, integrations (exchange credentials), webhook configurations, and keeps an auditable record of forwarded signals.

If you already own a Cloudflare domain (for example `daxlinksonline.link`) you can use the included Cloudflare Worker (`worker/webhook.js`) to route `{sub}.daxlinksonline.link/webhook` requests to this API while keeping the original Host header for subdomain extraction.

If you have an external mail server (for example Namecheap), configure SMTP credentials in the backend `.env` to enable verification and notification emails.

## Features

- Express server with CORS, Helmet, and request logging
- Modular routing (`/api/v1/...`) for dashboard, workspaces, integrations, and webhooks
- PostgreSQL data models via Prisma
- Service/controller separation for future business logic (e.g., DaxLinks execution engine / exchange SDK integration)
- Environment-driven configuration (`.env`)

## Getting Started

1. **Install dependencies**

   ```bash
   cd backend
   npm install
   ```

2. **Configure environment**

   Copy the example file and edit values to suit your setup:

   ```bash
   cp .env.example .env
   ```

      Ensure `DATABASE_URL` points to a PostgreSQL instance. Also set the following environment variables (see `.env.example`):

   - `WEBHOOK_BASE_DOMAIN` — the base domain used for host-based webhook ingress (e.g. `daxlinksonline.link`).
   - `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` — required if you want the app to create/verify Cloudflare A records for user subdomains.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM` — configure these to use your Namecheap mail server for transactional emails.
   - `REDIS_URL` — optional; when present the app uses BullMQ for queueing (recommended for production).

3. **Bootstrap the database**

   ```bash
   npm run prisma:generate
   npm run prisma:migrate -- --name init
   npm run prisma:seed
   ```

4. **Start the API**

   ```bash
   npm run dev
   ```

   The server listens on `http://localhost:4000` by default.

   After seeding, grab the generated workspace ID to test the endpoints:

   ```sql
   SELECT id, slug FROM "Workspace";
   ```

   Use that `workspaceId` when calling `/api/v1/dashboard/{workspaceId}/bootstrap`.

## Super Admin

Create or promote a user to full-access super admin using the built‑in script:

Prerequisites:
- `DATABASE_URL` configured in `backend/.env`
- Prisma client generated and DB migrated (`npm run prisma:generate` and `npm run prisma:deploy`)

Command:

```bash
cd backend
npm run create:super-admin -- --email=user@example.com --password='StrongPassword123!' --name='Your Name'
```

Notes:
- If the email exists, the user is updated with `role=superadmin`, `isSuperAdmin=true`, and `emailVerified=true`.
- If the email does not exist, a new user is created with those flags.
- Super admins bypass all admin checks and can access every admin route.

## Secret Access Portal

Privileged roles can sign in via a dedicated portal endpoint using username (email) and password.

Allowed roles: `superadmin`, `admin`, `developer`, `engineer`, `designer`.

API endpoints:

- POST `/api/v1/portal/login` — body: `{ "username": "email@example.com", "password": "..." }`
  - Returns `{ token, user }` on success; `403` if role not allowed.
- POST `/api/v1/portal/users` — Superadmin only. Create user `{ name, email, password, role }`.
- PATCH `/api/v1/portal/users/:userId/role` — Superadmin only. Assign role.
- POST `/api/v1/portal/users/:userId/password` — Superadmin only. Set/reset password.

UI:

- Open `ui/portal.html` for a minimal login form. On success, it stores the token and redirects to `ui/admin.html`.

### Registration Policy

- Public registration at `/api/v1/auth/register` is disabled and returns `403`.
- Superadmins should create accounts via `/api/v1/portal/users` and manage roles/passwords via portal endpoints.

## API Overview

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/v1/dashboard/:workspaceId/bootstrap` | Aggregate dashboard data for the UI |
| POST | `/api/v1/workspaces` | Create a workspace entry |
| GET | `/api/v1/integrations/:workspaceId` | List integrations |
| POST | `/api/v1/integrations/:workspaceId` | Create an integration (stores masked credentials) |
| POST | `/api/v1/integrations/:workspaceId/:integrationId/test` | Validates exchange credentials via SDK |
| GET | `/api/v1/webhooks/:workspaceId` | List webhooks |
| POST | `/api/v1/webhooks/:workspaceId` | Create webhook configuration |
| PATCH | `/api/v1/webhooks/:workspaceId/:webhookId` | Toggle webhook activation |
| POST | `/api/v1/webhook` | Public TradingView ingress (Host-based subdomain) |
| POST | `/api/v1/webhook/test` | Authenticated test alert (no DNS required) |
| GET | `/api/v1/dns/available/:name` | Check if custom subdomain is available |
| POST | `/api/v1/dns/register` | Create Cloudflare A record for user subdomain |
| GET | `/api/v1/dns/mine` | List current user’s custom DNS records |
| DELETE | `/api/v1/dns/:id` | Delete a custom DNS record (owner only) |
| GET | `/api/v1/admin/queues/stats` | Queue stats (admin) |
| GET | `/api/v1/admin/queues/jobs?state=failed&start=0&end=20` | List jobs by state (admin) |
| POST | `/api/v1/admin/queues/jobs/:id/retry` | Retry a failed job (admin) |
| DELETE | `/api/v1/admin/queues/jobs/:id` | Remove a job (admin) |
| POST | `/api/v1/admin/queues/clean` | Clean jobs by state (admin) |

### TradingView Ingress

- Host header must be `{sub}.<WEBHOOK_BASE_DOMAIN>`
- Body may include `secret` which is checked against user’s `webhookSecret`
- Returns `410 Gone` when the user is inactive or past `trialEndsAt`
- Rate limited to 20 req/sec per subdomain; IP whitelist via `TRADINGVIEW_IPS`

### DNS Registration

- Validates subdomain format and public IP
- Ensures subdomain is not used by platform webhooks or existing DNS records
- Creates Cloudflare A record (unproxied) and stores `cloudflareId`
## Environment

Add these to `.env`:

- `WEBHOOK_BASE_DOMAIN=daxlinksonline.link`
- `TRADINGVIEW_IPS=52.89.214.238,34.212.191.235` (example; keep updated)
- `TRADINGVIEW_IPS_URL=https://...` (auto-refresh from TradingView docs)
- `TRADINGVIEW_IPS_FILE=backend/.cache/tradingview_ips.json` (written by cron)
- `CLOUDFLARE_API_TOKEN=...`
- `CLOUDFLARE_ZONE_ID=...`
- `REDIS_URL=redis://localhost:6379` (optional; enables BullMQ)
- `SMTP_HOST=...`, `SMTP_PORT=...`, `SMTP_USERNAME=...`, `SMTP_PASSWORD=...`, `EMAIL_FROM=alerts@daxlinks.online`

## Deployment (Cloudflare & Mail)

If you're hosting on Cloudflare with domain `daxlinksonline.link` and using Namecheap for mail, follow these recommended steps:

1) DNS and worker routing

- Add DNS A record for your backend host (if hosting on a VM) and set it to DNS-only (unproxied) when the app needs direct public IP access for some records. Example:

   - Type: A
   - Name: @
   - Content: <your server public IP>
   - Proxy status: DNS only

- Deploy the Cloudflare Worker (`worker/webhook.js`) and add a route such as `*.daxlinksonline.link/webhook`. This lets the Worker proxy incoming TradingView webhook POSTs to your API while preserving the original Host header.

2) Cloudflare API (optional)

- To auto-create or manage user subdomain A records from the app, set `CLOUDFLARE_API_TOKEN` (DNS edit scope) and `CLOUDFLARE_ZONE_ID` in your `.env`.

3) TradingView webhook configuration

- Use webhook URLs of the form `https://<sub>.daxlinksonline.link/webhook` in TradingView alerts.
- Optionally include a `secret` key in the alert body to be matched against a user's `webhookSecret` stored in the app.

4) Mail (Namecheap)

- Configure MX records for your domain in Cloudflare to route mail to Namecheap's mail servers (if using Namecheap mail hosting).
- Put the Namecheap SMTP credentials into your backend `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `EMAIL_FROM`.

5) Deploy worker with Wrangler (example)

```bash
npm install -g wrangler
cd worker
# ensure wrangler.toml contains account & route info
wrangler publish
```

6) Security

- The app uses `TRADINGVIEW_IPS` and a cron refresh task to keep a whitelist of TradingView IPs; keep `TRADINGVIEW_IPS_URL` configured.
- Prefer using `REDIS_URL` in production for reliable queueing with BullMQ.


## Cron

- Run `node src/cron/dnsCleanup.js` daily (e.g., 02:00 UTC) to:
  - Email users 24h before trial end
  - Deactivate expired users and delete their Cloudflare A records
 - Run `node src/cron/updateTradingViewIps.js` hourly to refresh TradingView IP whitelist into `TRADINGVIEW_IPS_FILE`.
## Next Steps

- Replace credential placeholders with secure vault access (Hashicorp Vault, AWS Secrets Manager, etc.)
- Wire `testIntegration` to the real exchange connectors (DaxLinks SDK alias)
- Implement authentication/authorization for admin users
- Extend models with auditing, strategy metadata, or event streaming as needed
- Deploy using containerization (Dockerfile + orchestration) or serverless adapter

This scaffold is the foundation for connecting the UI mockup to a true backend. Feel free to expand the schema, routes, and services to match your production requirements.
## Queue & Forwarding

- If `REDIS_URL` is set, forwarding jobs run on BullMQ with retries.
- Without Redis, an in-memory fallback processes alerts inline.
- Processor: normalizes TradingView payload → order params, computes idempotency key, decrypts credentials, initializes exchange, tries common order methods, logs success/failure, and records `ForwardedSignal`.

### Admin Endpoints
- Basic queue introspection and controls under `/api/v1/admin/queues/*` guarded by admin auth.

### Idempotency
- Prisma model `ForwardedSignal` with unique `idempotencyKey` prevents duplicate execution across retries.
- Key derived from `{userId,symbol,side,type,amount,price,clientOrderId,timestamp}`.

## Cloudflare Worker (optional)

- worker/webhook.js proxies `POST /webhook` from `{sub}.<domain>` to your origin API `/api/v1/webhook` and sets `x-forwarded-host` to the original host for subdomain extraction.
- Wrangler config example:

  name = "pendax-webhook"
  main = "worker/webhook.js"
  compatibility_date = "2024-11-01"
  [vars]
  ORIGIN_URL = "https://api.yourdomain.com"
  
  # Routes example
  routes = [
    { pattern = "*.daxlinksonline.link/webhook", zone_name = "daxlinksonline.link" }
  ]
| GET | `/api/v1/admin/ingress/ips` | Current allowed TradingView IPs (admin) |
