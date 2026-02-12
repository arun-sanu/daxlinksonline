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
      return { ts, message: `{\"symbol\":\"BTCUSDC\",\"side\":\"BUY\",\"ts\":${ts}}` };
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
  findDuplicateAudit: async () => null
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
  const payload = { ...unordered, symbol: 'BTCUSDC', side: 'BUY', ts };
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
  const message = `{\"symbol\":\"BTCUSDC\",\"side\":\"BUY\",\"ts\":${ts}}`;
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
