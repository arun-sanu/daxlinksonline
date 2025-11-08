Cloudflare Worker + DNS + Mail deployment guide for daxlinksonline.link

This document explains how to deploy the included Cloudflare Worker proxy (`worker/webhook.js`), configure DNS for host-based TradingView subdomains, and wire Namecheap SMTP credentials for backend transactional mail.

1) Prepare the Worker project

- Ensure `worker/webhook.js` exists in the `worker/` folder (it does in this repo).
- Create `worker/wrangler.toml` or use the included `worker/wrangler.example.toml` as a template.

Example `worker/wrangler.toml` values (replace placeholders):

```
name = "daxlinks-webhook"
main = "worker/webhook.js"
compatibility_date = "2025-11-08"

account_id = "your_cloudflare_account_id"

[vars]
ORIGIN_URL = "https://api.daxlinksonline.com" # Your backend origin

# Routes can be managed in the Cloudflare dashboard or here
# routes = ["*.daxlinksonline.link/webhook"]
```

2) Publish the Worker using Wrangler

- Install Wrangler:

```bash
npm install -g wrangler
```

- Authenticate Wrangler with your Cloudflare account:

```bash
wrangler login
```

- Publish from the `worker/` directory:

```bash
cd worker
wrangler publish
```

Note: If you prefer to manage routes in the Cloudflare dashboard, do not include `routes` in `wrangler.toml` and instead add the route in the dashboard (see step 4).

3) Cloudflare DNS

- In the Cloudflare dashboard for `daxlinksonline.link`:
  - Add an A record for your backend host (if hosting on a VM):
    - Type: A
    - Name: @ or your host (e.g., api)
    - Content: <your server public IP>
    - Proxy status: DNS only

- For user webhook subdomains created by the app (e.g., `alice.daxlinksonline.link`), the app will create A records via the Cloudflare API. These records should be set to DNS only (unproxied) to ensure the Worker receives the original host header and traffic reach the backend origin.

DNS records checklist (exact entries to add)

Replace any `<PLACEHOLDER>` values with your actual IPs/hosts.

1) API host (recommended)

 - Type: A
 - Name: `api`
 - Content: `<YOUR_BACKEND_PUBLIC_IP>`
 - TTL: Auto
 - Proxy status: DNS only (grey cloud)

  Why: the Worker will fetch `https://api.daxlinksonline.link` as the origin (`ORIGIN_URL`). Keeping the API host DNS-only avoids Cloudflare proxying the origin, which simplifies origin TLS handling and ensures the Worker connects directly to your server IP.

2) Root domain / web (optional)

 - Type: A
 - Name: `@`
 - Content: `<YOUR_FRONTEND_PUBLIC_IP or same as API IP>`
 - TTL: Auto
 - Proxy status: Proxied (orange cloud) OR DNS only if you prefer direct origin routing

 - Type: CNAME
 - Name: `www`
 - Content: `@`
 - Proxy status: Proxied (orange cloud)

3) Webhook subdomains created by the app (automated)

 - For each user subdomain (e.g., `alice.daxlinksonline.link`) the app will create an A record via the Cloudflare API.
 - Ensure these A records are created with Proxy status: DNS only (grey cloud).
 - Example (automated):
   - Type: A
   - Name: `alice`
   - Content: `<YOUR_BACKEND_PUBLIC_IP>`
   - Proxy status: DNS only

  Why: TradingView requires the Worker to receive the original Host header and the Worker must forward to your API origin. DNS-only ensures the Worker and TradingView traffic are routed correctly.

4) Mail (Namecheap) — example entries

 - Add MX records as provided by Namecheap. Example (replace with the exact values Namecheap gives you):
   - Type: MX
   - Name: `@`
   - Content: `mx1.privateemail.com`
   - Priority: 10

   - Type: MX
   - Name: `@`
   - Content: `mx2.privateemail.com`
   - Priority: 10

 - Add SPF TXT record (example; use Namecheap guidance if they provide a different value):
   - Type: TXT
   - Name: `@`
   - Content: `v=spf1 include:privateemail.com ~all`

 - Add DKIM / DMARC as provided by Namecheap (they will supply selector and TXT values). Example DMARC:
   - Type: TXT
   - Name: `_dmarc`
   - Content: `v=DMARC1; p=quarantine; rua=mailto:postmaster@daxlinksonline.link; ruf=mailto:postmaster@daxlinksonline.link; pct=100`

5) Worker route

 - In Cloudflare Dashboard -> Workers, add a route (or include it in `wrangler.toml`):
   - Route: `*.daxlinksonline.link/webhook`
   - Worker: `daxlinks-webhook` (or the name you published)

Checklist (step-by-step)

 - [ ] Add `api` A record pointing to your backend public IP (DNS only)
 - [ ] Add root `@` A record and `www` CNAME as needed (choose proxied or DNS-only based on whether you want Cloudflare CDN)
 - [ ] Add MX, SPF, DKIM, DMARC as instructed by Namecheap
 - [ ] Deploy the Worker and add route `*.daxlinksonline.link/webhook`
 - [ ] Add GitHub repo secrets: `CF_API_TOKEN`, `CF_ACCOUNT_ID`=`beda455cdcb069b4d415c7eb817ecb46`, `CF_ZONE_ID`=`d573fbfbaa86d3ffbbfe9d7895ceb5e8`
 - [ ] Test with an authenticated test alert and with a TradingView webhook using `https://<sub>.daxlinksonline.link/webhook`

Notes on TLS / origin certificates

 - If you enable Cloudflare proxy (orange cloud) for your root domain, Cloudflare will terminate SSL at the edge. For the Worker -> origin fetch to succeed with `ORIGIN_URL = https://api.daxlinksonline.link`:
   - Keep `api` as DNS-only and ensure the origin has a valid certificate (Let's Encrypt or CA-signed). Use Full (strict) SSL mode in Cloudflare for best security.
   - Alternatively use Cloudflare Origin CA certificate on your origin and set SSL to Full (strict). Do not use Flexible mode.

If you want, I can produce a small copy-paste checklist formatted for the Cloudflare UI, or I can create the DNS records for you via the Cloudflare API if you provide `CF_API_TOKEN` with DNS edit scope.

4) Add a Worker route (if not managed by `wrangler.toml`)

- In Cloudflare dashboard -> Workers -> Add route
  - Route: `*.daxlinksonline.link/webhook`
  - Worker: select the published `daxlinks-webhook` worker

5) Configure the backend

- Edit `backend/.env` (copy from `.env.example`) and set:
  - `WEBHOOK_BASE_DOMAIN=daxlinksonline.link`
  - `ORIGIN_URL` (if used) or ensure `worker/wrangler.toml` `ORIGIN_URL` points to your backend origin
  - `CLOUDFLARE_API_TOKEN` (with DNS edit scope) and `CLOUDFLARE_ZONE_ID` if you want the backend to programmatically manage DNS records
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM` for Namecheap mail
  - `DATABASE_URL` to your PostgreSQL instance
  - `REDIS_URL` (recommended for production)

CI / GitHub Actions secrets

- Add these repository secrets in GitHub (Settings → Secrets → Actions):
  - `CF_API_TOKEN` — Cloudflare API token (Workers Scripts:Edit, Zone:DNS Edit)
  - `CF_ACCOUNT_ID` — `beda455cdcb069b4d415c7eb817ecb46`
  - `CF_ZONE_ID` — `d573fbfbaa86d3ffbbfe9d7895ceb5e8`

The repo includes a workflow at `.github/workflows/publish-worker.yml` which uses `CF_API_TOKEN`, `CF_ACCOUNT_ID`, and `CF_ZONE_ID` to publish the worker on pushes to `main`.

6) Namecheap Mail / SMTP

- In Namecheap account: enable Private Email hosting (or use their SMTP service) and note the SMTP host, port, and credentials.
- Add MX records in Cloudflare pointing to Namecheap's mail servers as per Namecheap docs.
- Put the SMTP settings into `backend/.env`.

7) Security

- Keep `CLOUDFLARE_API_TOKEN` secret (use secrets in CI/CD environment).
- Consider using HTTPS for your backend origin and use Cloudflare's SSL features.
- Use `TRADINGVIEW_IPS` and keep `TRADINGVIEW_IPS_URL` configured to auto-refresh the TradingView IP list.

8) Testing

- Create a test workspace and obtain a subdomain (or use a manual DNS entry) and send a test POST to `https://<sub>.daxlinksonline.link/webhook`.
- Use the `/api/v1/webhook/test` endpoint to perform authenticated test alerts if needed.

If you want, I can also commit a minimal `wrangler.toml` with placeholders and a small CI job example for GitHub Actions to publish the worker securely using Cloudflare API tokens.
