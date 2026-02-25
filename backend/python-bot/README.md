# MEXC Python Bot (MACD + Bollinger)

This is a standalone Python bot process (separate from your Node.js backend) that:

- Streams real-time prices from MEXC WebSocket
- Runs the MACD + Bollinger strategy from your Pine script
- Places market orders on MEXC spot
- Reports every executed order to `POST /api/v1/internal/bot/order-result`
- Supports graceful shutdown and PM2 process management
- Resolves exchange credentials from backend-linked exchange account (via bot instance/runtime)

## Files

- `python-bot/mexc_bot.py`
- `python-bot/requirements.txt`
- `python-bot/.env.example`

## Install

```bash
cd /opt/daxlinks/backend/backend/python-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# edit .env
```

## Run manually

```bash
cd /opt/daxlinks/backend/backend/python-bot
source .venv/bin/activate
python3 mexc_bot.py
```

## Run with PM2

From project root:

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs mexc-bot
```

## Publish In Trade Bots Marketplace

Register this bot template once in the provider workspace:

```bash
cd /opt/daxlinks/backend/backend
npm run bot:register:mexc-macd-bollinger -- --workspaceId=<provider-workspace-uuid>
```

Then users can rent it from `/api/v1/trade-bots/:workspaceId/market` and it will appear in their Trade Bots list.

Register the ARN Pine-faithful template:

```bash
cd /opt/daxlinks/backend/backend
npm run bot:register:arn-s-shcs-original -- --workspaceId=<provider-workspace-uuid>
```

ARN service file:

- `python-bot/arn_bot_service_pine_faithful.py` (FastAPI endpoint: `POST /signal`)

Register the ARN limit-only template:

```bash
cd /opt/daxlinks/backend/backend
npm run bot:register:arn-s-shcs-limit-only -- --workspaceId=<provider-workspace-uuid>
```

ARN limit-only service file:

- `python-bot/arn_bot_service_limit_only.py` (FastAPI endpoint: `POST /webhook?token=...`)

## Notes

- The backend currently validates internal token (`Authorization: Bearer ...` or `X-Internal-Token`).
- This bot also sends `X-Signature` (HMAC-SHA256 of request body with `INTERNAL_BOT_TOKEN`).
- For linked-exchange mode, set `RESOLVE_EXCHANGE_FROM_BACKEND=true` and provide an existing `BOT_INSTANCE_ID`.
- Linked mode uses backend internal runtime endpoint: `GET /api/v1/internal/bot/runtime-config/:botInstanceId`.
- Runtime rules can override base quantity when `rules.baseQuantity` (or `base_quantity`) is present.
- Default behavior is spot long-only (`ALLOW_SHORTS=false`).
