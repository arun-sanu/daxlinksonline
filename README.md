# DaxLinksOnline
**Turns any URL into a trackable short-link with QR code in 8 seconds.**

![CI](https://github.com/arun-sanu/daxlinksonline/actions/workflows/ci.yml/badge.svg)

DaxLinksOnline is a Pendax-based webhook forwarding and trading control plane. It receives TradingView alerts (via host-based webhooks), validates and normalizes them, and forwards them to exchange connectors or trading bots in real-time. The backend is an Express + Prisma API that manages workspaces, integrations (exchange credentials), webhooks, and forwarding/queueing logic.

This repository contains:

- A backend API (Node.js + Express + Prisma) that stores workspaces, users, integrations, webhooks, and forwarded signals.
- Cloudflare Worker proxy (in `worker/webhook.js`) for handling host-based webhook ingress from TradingView subdomains.
- Simple static UI pages in `ui/` for portal/admin interactions.
- Example WebSocket templates in `Examples/`.

The platform is built on top of the Pendax connectors (see backend dependency `@compendiumfi/pendax`) for exchange integrations.

If you host the project on a domain (for example `daxlinksonline.link` on Cloudflare), you can configure host-based webhook subdomains like `{sub}.daxlinksonline.link` to forward TradingView alerts to your backend while preserving the original host header for subdomain extraction.

Quick start (backend):

```bash
cd backend
npm install
cp .env.example .env
# set DATABASE_URL, WEBHOOK_BASE_DOMAIN, CLOUDFLARE_* and SMTP_* variables in .env
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

For Cloudflare Worker deployment and DNS configuration, see `deploy.md` and the sample config in `worker/wrangler.example.toml`.

For more details, see `backend/README.md` which contains environment and operational notes.
