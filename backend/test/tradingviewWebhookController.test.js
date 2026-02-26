import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { createTradingviewWebhookHandler } from '../src/controllers/tradingviewWebhookController.js';

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };
}

function createReq({ prefix = 'demo', secret = 'secret', body, rawBody } = {}) {
  const payload =
    body ||
    (() => {
      const ts = Date.now();
      return { ts, message: `{\"symbol\":\"BTCUSDC\",\"side\":\"BUY\",\"qty\":0.01,\"ts\":${ts}}` };
    })();
  const buffer =
    rawBody ||
    (typeof payload.message === 'string' && Object.keys(payload).length === 2
      ? Buffer.from(JSON.stringify(payload))
      : Buffer.from(JSON.stringify(payload)));
  return {
    subdomainPrefix: prefix,
    headers: {},
    query: { secret },
    body: { ...payload },
    rawBody: buffer
  };
}

const noopExecutionDeps = {
  resolveExecutionTarget: async () => null,
  getHmacPolicy: async () => ({ enforceGlobal: true, disableTradingview: false }),
  createAudit: async () => ({ id: 'audit-1' }),
  updateAudit: async () => ({}),
  findDuplicateAudit: async () => null,
  resolveRuntimeOrderPolicy: async () => ({ arnOriginal: false, arnLimitOnly: false, runtimeOrderType: null })
};

function canonicalize(obj) {
  if (Array.isArray(obj)) {
    return obj.map((entry) => canonicalize(entry));
  }
  if (obj && typeof obj === 'object') {
    const sorted = Object.keys(obj)
      .filter((key) => !['hmac', 'signature', 'sign'].includes(key))
      .sort();
    return sorted.reduce((acc, key) => {
      acc[key] = canonicalize(obj[key]);
      return acc;
    }, {});
  }
  return obj;
}

test('tradingview webhook handler accepts valid secret and HMAC', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex') };
  const req = createReq();
  const hmac = crypto
    .createHmac('sha256', Buffer.from(user.webhookHmacKey, 'hex'))
    .update(Buffer.from(req.body.message, 'utf8'))
    .digest('hex');
  req.body.hmac = hmac;

  let forwarded = false;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true, allowBodySecret: false },
    {
      findUser: async () => user,
      forwarder: async () => {
        forwarded = true;
      },
      ...noopExecutionDeps
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, message: 'queued' });
  assert.equal(forwarded, true);
});

test('tradingview webhook handler rejects invalid secret', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex') };
  const req = createReq({ secret: 'wrong' });
  req.body.hmac = '00';
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async () => {},
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload?.error, 'Invalid secret');
});

test('tradingview webhook handler enforces timestamp skew', async () => {
  process.env.WEBHOOK_MAX_SKEW_MS = '1000';
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex') };
  const past = Date.now() - 10 * 60 * 1000;
  const req = createReq({ body: { ts: past, message: `{\"symbol\":\"BTCUSDC\",\"side\":\"BUY\",\"ts\":${past}}` } });
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async () => {},
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.payload?.error || '', /Replay detected/i);
  delete process.env.WEBHOOK_MAX_SKEW_MS;
});

test('tradingview webhook handler validates sorted JSON payload HMAC', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex') };
  const unordered = { z: 5, a: 'alpha', nested: { b: 2, a: 1 } };
  const ts = Date.now();
  const payload = { ...unordered, symbol: 'BTCUSDC', side: 'BUY', qty: 0.01, ts };
  const canonical = JSON.stringify(canonicalize(payload));
  const signature = crypto.createHmac('sha256', Buffer.from(user.webhookHmacKey, 'hex')).update(Buffer.from(canonical, 'utf8')).digest('hex');
  const req = createReq({
    body: { ...payload, hmac: signature }
  });
  req.rawBody = Buffer.from(JSON.stringify(req.body));
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async () => {},
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 200);
});

test('tradingview webhook handler enforces missing HMAC when required', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex'), enforceHmac: true };
  const req = createReq();
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async () => {},
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 401);
  assert.match(res.payload?.error || '', /HMAC/);
});

test('tradingview webhook handler accepts plain text payload HMAC', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: crypto.randomBytes(32).toString('hex') };
  const ts = Date.now();
  const message = `{\"symbol\":\"BTCUSDC\",\"side\":\"BUY\",\"qty\":0.01,\"ts\":${ts}}`;
  const hmac = crypto.createHmac('sha256', Buffer.from(user.webhookHmacKey, 'hex')).update(Buffer.from(message, 'utf8')).digest('hex');
  const body = { message, ts, hmac };
  const req = createReq({ body, rawBody: Buffer.from(message) });
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async () => {},
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 200);
});

test('tradingview webhook handler parses default plain text strategy fill messages', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const plainTextBody =
    'ARN - Safe and Strict High Compounding Strategy (1, 1, 1.5, 90, 5, 2, 14, 20, 2, 0.05): order buy @ 1.5412 filled on ETHUSDE. New strategy position is 0.7708';
  const req = {
    subdomainPrefix: 'demo',
    headers: { 'content-type': 'text/plain' },
    query: { secret: 'secret' },
    body: plainTextBody,
    rawBody: Buffer.from(plainTextBody, 'utf8'),
    rawBodyText: plainTextBody
  };

  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      ...noopExecutionDeps
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload?.error, 'qty missing in signal payload');
  assert.equal(forwardedPayload, null);
});

test('tradingview webhook handler rejects JSON payload when qty is missing', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const ts = Date.now();
  const req = createReq({
    body: { ts, symbol: 'BTCUSDC', side: 'BUY' },
    rawBody: Buffer.from(JSON.stringify({ ts, symbol: 'BTCUSDC', side: 'BUY' }), 'utf8')
  });
  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      ...noopExecutionDeps
    }
  );
  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload?.error, 'qty missing in signal payload');
  assert.equal(forwardedPayload, null);
});

test('tradingview webhook rejects non-ETHUSDC symbols for ARN limit-only bot', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const ts = Date.now();
  const req = createReq({
    body: { ts, symbol: 'BTCUSDC', side: 'BUY', qty: 0.01, type: 'LIMIT' },
    rawBody: Buffer.from(JSON.stringify({ ts, symbol: 'BTCUSDC', side: 'BUY', qty: 0.01, type: 'LIMIT' }), 'utf8')
  });

  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      ...noopExecutionDeps,
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      resolveExecutionTarget: async () => ({
        workspaceId: 'ws-1',
        integrationId: 'ig-1',
        botId: 'bot-1'
      }),
      resolveRuntimeOrderPolicy: async () => ({
        arnOriginal: false,
        arnLimitOnly: true,
        runtimeOrderType: 'LIMIT'
      })
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload?.error, 'ARN limit-only bot currently supports ETHUSDC only.');
  assert.equal(forwardedPayload, null);
});

test('tradingview webhook rejects non-BTCUSDC symbols for ARN original bot', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const ts = Date.now();
  const req = createReq({
    body: { ts, symbol: 'ETHUSDC', side: 'BUY', qty: 0.01, type: 'MARKET' },
    rawBody: Buffer.from(JSON.stringify({ ts, symbol: 'ETHUSDC', side: 'BUY', qty: 0.01, type: 'MARKET' }), 'utf8')
  });

  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      ...noopExecutionDeps,
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      resolveExecutionTarget: async () => ({
        workspaceId: 'ws-1',
        integrationId: 'ig-1',
        botId: 'bot-1'
      }),
      resolveRuntimeOrderPolicy: async () => ({
        arnOriginal: true,
        arnLimitOnly: false,
        runtimeOrderType: null
      })
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload?.error, 'ARN original bot currently supports BTCUSDC only.');
  assert.equal(forwardedPayload, null);
});

test('tradingview webhook rejects LIMIT for ARN original bot (market only)', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const ts = Date.now();
  const req = createReq({
    body: { ts, symbol: 'BTCUSDC', side: 'BUY', qty: 0.01, type: 'LIMIT' },
    rawBody: Buffer.from(JSON.stringify({ ts, symbol: 'BTCUSDC', side: 'BUY', qty: 0.01, type: 'LIMIT' }), 'utf8')
  });

  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      ...noopExecutionDeps,
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      resolveExecutionTarget: async () => ({
        workspaceId: 'ws-1',
        integrationId: 'ig-1',
        botId: 'bot-1'
      }),
      resolveRuntimeOrderPolicy: async () => ({
        arnOriginal: true,
        arnLimitOnly: false,
        runtimeOrderType: null
      })
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload?.error, 'Invalid orderType for ARN original bot. Use MARKET.');
  assert.equal(forwardedPayload, null);
});

test('tradingview webhook coerces MARKET to LIMIT_MAKER for ARN limit-only bot when type missing', async () => {
  const user = { id: 'user-1', webhookSecret: 'secret', webhookHmacKey: null };
  const ts = Date.now();
  const req = createReq({
    body: { ts, symbol: 'ETHUSDC', side: 'BUY', qty: 0.01 },
    rawBody: Buffer.from(JSON.stringify({ ts, symbol: 'ETHUSDC', side: 'BUY', qty: 0.01 }), 'utf8')
  });

  let forwardedPayload = null;
  const handler = createTradingviewWebhookHandler(
    { requireQuerySecret: true },
    {
      ...noopExecutionDeps,
      findUser: async () => user,
      forwarder: async (_userId, payload) => {
        forwardedPayload = payload;
      },
      resolveExecutionTarget: async () => ({
        workspaceId: 'ws-1',
        integrationId: 'ig-1',
        botId: 'bot-1'
      }),
      resolveRuntimeOrderPolicy: async () => ({
        arnOriginal: false,
        arnLimitOnly: true,
        runtimeOrderType: 'LIMIT_MAKER'
      })
    }
  );

  const res = createRes();
  await handler(req, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload?.ok, true);
  assert.equal(forwardedPayload?.orderType, 'LIMIT_MAKER');
  assert.equal(forwardedPayload?.type, 'limit_maker');
});
