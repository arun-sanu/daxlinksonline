# trade-exec-bot

Python microservice for DaxLinks signal execution on MEXC spot.

## What It Does

- Receives signals on `POST /webhook` with HMAC verification (`X-Signature`).
- Maps either normalized signal payloads or legacy DaxLinks alert payloads into one contract.
- Loads market rules + balances, computes order sizing with strict guardrails.
- Runs risk checks (symbol exists, cooldown, open-order cap, balance checks, daily-loss hook stub).
- Places entry orders and then tries protection orders (OCO first, then fallback trigger orders).
- Sends full sizing telemetry + execution result to DaxLinks backend:
  - `POST /api/v1/internal/bot/order-result`

## Run Locally

```bash
cd trade-exec-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8091
```

## Docker

```bash
cd trade-exec-bot
docker build -t trade-exec-bot:local .
docker run --rm -p 8091:8091 --env-file .env trade-exec-bot:local
```

## Signal Contract (normalized)

```json
{
  "id": "signal-uuid",
  "symbol": "BTC/USDC",
  "side": "buy",
  "order": { "type": "market", "limit_price": null },
  "risk": { "mode": "balance_pct", "value": 1.0, "min_quote_spend": 1.05, "max_quote_spend": 50.0 },
  "sl": { "type": "percent", "value": 2.0 },
  "tp": { "type": "rr", "value": 3.0 },
  "meta": { "strategy": "ARN", "timeframe": "5m", "source": "tradingview" },
  "timestamp": 1739459200
}
```

## Legacy Alert Example (auto-mapped)

```json
{
  "alertId": "tv-123",
  "symbol": "BTCUSDC",
  "side": "BUY",
  "orderType": "market",
  "riskPct": 1.0,
  "minQuoteSpend": 1.05,
  "maxQuoteSpend": 50,
  "stopLoss": 2.0,
  "takeProfit": 3.0,
  "strategyName": "ARN",
  "timeframe": "5m",
  "timestamp": 1739459200
}
```

## Test Webhook With cURL

```bash
export BOT_WEBHOOK_SECRET='replace_me'
payload='{"id":"signal-1","symbol":"BTC/USDC","side":"buy","order":{"type":"market","limit_price":null},"risk":{"mode":"balance_pct","value":1.0,"min_quote_spend":1.05,"max_quote_spend":50},"sl":{"type":"percent","value":2.0},"tp":{"type":"rr","value":3.0},"meta":{"strategy":"ARN","timeframe":"5m","source":"tradingview"},"timestamp":1739459200}'
sig=$(printf '%s' "$payload" | openssl dgst -sha256 -hmac "$BOT_WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -X POST 'http://localhost:8091/webhook' \
  -H "Content-Type: application/json" \
  -H "X-Signature: $sig" \
  -d "$payload"
```

## Response Shape

```json
{
  "ok": true,
  "signalId": "signal-1",
  "entryOrder": {},
  "protection": { "tp": {}, "sl": {}, "errors": [] },
  "sizing": {},
  "errors": []
}
```

## Unit Tests

```bash
cd trade-exec-bot
pytest -q
```
