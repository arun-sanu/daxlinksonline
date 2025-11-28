Hetzner production preparation checklist
=======================================

This is a short runbook to get the backend running on a Hetzner VM (Ubuntu 22.04/24.04). It assumes a single host running Node.js + PostgreSQL + Redis, fronted by Nginx/Caddy for TLS, and Cloudflare for DNS/Worker routing.

Pre-flight
- VM ready with ports 80/443 open; SSH access for `root` or a sudo user.
- Domain in Cloudflare (e.g. `daxlinksonline.link`) with an `A` record pointing to the VM (DNS-only for the API origin).
- PostgreSQL instance reachable and a database created for this app.
- Redis endpoint available (recommended for queues; the app will fall back to in-memory if omitted).
- Secrets noted: `DATABASE_URL`, `JWT_SECRET` (>=24 chars), `KMS_KEY` (32-byte base64), `WEBHOOK_BASE_DOMAIN`, SMTP creds, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`.

Server bootstrap
```bash
sudo apt update && sudo apt install -y ca-certificates curl git ufw
# Node 20 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Optional: local Postgres/Redis if you are not using managed services
sudo apt install -y postgresql redis-server

# App user + folders
sudo useradd -r -s /usr/sbin/nologin daxlinks || true
sudo mkdir -p /opt/daxlinks/backend /etc/daxlinks
sudo chown -R daxlinks:daxlinks /opt/daxlinks /etc/daxlinks

# Firewall (allow HTTP/HTTPS + SSH)
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw --force enable
```

Deploy the code
```bash
sudo -u daxlinks git clone https://github.com/arun-sanu/daxlinksonline.git /opt/daxlinks/backend
cd /opt/daxlinks/backend/backend
sudo -u daxlinks npm ci --omit=dev

# Generate Prisma client and apply migrations
sudo -u daxlinks npx prisma generate
sudo -u daxlinks env DATABASE_URL="postgres://..." npx prisma migrate deploy
# (optional) seed demo data: sudo -u daxlinks npm run prisma:seed
```

Environment file (`/etc/daxlinks/backend.env`)
```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://user:pass@db-host:5432/pendax
JWT_SECRET=change-me-to-a-strong-secret
KMS_KEY=MzJfYnl0ZV9rZXlfYmFzZTY0X2V4YW1wbGU9
WEBHOOK_BASE_DOMAIN=daxlinksonline.link
CORS_ORIGINS=https://app.daxlinksonline.link

# Optional services
REDIS_URL=redis://localhost:6379
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...

# SMTP (set all or leave all empty)
SMTP_HOST=smtp.namecheap.com
SMTP_PORT=587
SMTP_USERNAME=alerts@daxlinks.online
SMTP_PASSWORD=...
EMAIL_FROM=alerts@daxlinks.online

APP_BASE_URL=https://app.daxlinksonline.link
FEATURE_NOTIFICATIONS=true
```

Systemd unit (`/etc/systemd/system/daxlinks.service`)
```
[Unit]
Description=DaxLinks backend API
After=network.target

[Service]
Type=simple
User=daxlinks
Group=daxlinks
WorkingDirectory=/opt/daxlinks/backend/backend
EnvironmentFile=/etc/daxlinks/backend.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable + start
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now daxlinks.service
sudo systemctl status daxlinks.service
```

Reverse proxy + TLS
- Point `api.<domain>` A record to the VM (DNS-only).
- Use Nginx or Caddy to terminate TLS and forward to `http://127.0.0.1:4000`.
- Example Nginx snippet:
```
server {
  listen 80;
  server_name api.daxlinksonline.link;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```
Issue a certificate via `certbot --nginx` or let Caddy manage TLS automatically.

Operational checks
- `curl -f http://127.0.0.1:4000/healthz` should return `{"status":"ok",...}`.
- `sudo journalctl -u daxlinks -f` to tail logs.
- Run `npm run create:super-admin -- --email=... --password=... --name=...` once to bootstrap access.
- Ensure the Cloudflare Worker route `*.daxlinksonline.link/webhook` points to your origin and `WEBHOOK_BASE_DOMAIN` matches.

Cutover steps for tomorrow
- Populate `/etc/daxlinks/backend.env` with final secrets and restart the service.
- Validate DB connectivity (`psql "$DATABASE_URL" -c 'select now();'`).
- Validate Redis connectivity if used (`redis-cli PING`).
- Switch DNS/Worker to the new API IP, then send a test webhook to `https://<sub>.daxlinksonline.link/webhook` and check logs.
