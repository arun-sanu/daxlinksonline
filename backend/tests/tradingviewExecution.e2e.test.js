import request from 'supertest';
import nock from 'nock';
import { jest, describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';

import { createServer } from '../src/app.js';
import '../src/jobs/executeOrderProcessor.js';
import { prisma } from '../src/utils/prisma.js';
import {
  mockMexcForSizingOnly,
  mockMexcSpotFlow,
  resetDb,
  seedBotSizingConfig,
  waitFor,
  waitForExecutionAuditStatus
} from './helpers/tradingviewExecutionTestUtils.js';

const MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const FIXED_TIME_MS = Date.parse('2026-02-12T01:03:13.000Z');

jest.setTimeout(30000);

describe('TradingView -> DaxLinks -> MEXC Spot (BASE quantity)', () => {
  let app;

  beforeAll(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect((host) => host.includes('127.0.0.1') || host.includes('localhost'));
    app = await createServer();
  });

  afterAll(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await resetDb();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_TIME_MS);
    await resetDb();
    nock.cleanAll();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    nock.cleanAll();
  });

  async function sendTradingviewWebhook({ prefix, secret, payload, contentType = 'application/json' }) {
    const req = request(app)
      .post(`/webhook/tradingview?secret=${encodeURIComponent(secret)}`)
      .set('Host', `${prefix}.daxlinksonline.link`)
      .set('Content-Type', contentType);

    if (contentType === 'text/plain') {
      return req.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
    }
    return req.send(payload);
  }

  test('parses application/json and sends MARKET order with BASE quantity only', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.001234 }
      }
    });

    const mock = mockMexcSpotFlow({
      symbol: 'BTCUSDC',
      freeQuote: 500,
      price: 50000,
      stepSize: 0.000001,
      minNotional: 5,
      orderId: 'A10001'
    });

    const payload = { symbol: 'BTCUSDC', side: 'buy', ts: FIXED_TIME_MS };
    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload,
      contentType: 'application/json'
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'BUY',
      tvTs: FIXED_TIME_MS,
      statuses: ['SENT', 'FILLED']
    });

    expect(audit.status === 'SENT' || audit.status === 'FILLED').toBe(true);
    expect(audit.side).toBe('BUY');
    expect(audit.symbol).toBe('BTCUSDC');
    expect(Number(audit.qtyRounded)).toBeCloseTo(0.001234, 12);
    expect(String(audit.mexcOrderId)).toBe('A10001');

    const orderQuery = mock.getOrderQuery();
    expect(orderQuery).toBeTruthy();
    expect(orderQuery.symbol).toBe('BTCUSDC');
    expect(orderQuery.side).toBe('BUY');
    expect(orderQuery.type).toBe('MARKET');
    expect(orderQuery.quantity).toBe('0.001234');
    expect(orderQuery.timestamp).toBeTruthy();
    expect(orderQuery.signature).toBeTruthy();
    expect(orderQuery.quoteOrderQty).toBeUndefined();
    expect(orderQuery.amount).toBeUndefined();

    expect(mock.scope.isDone()).toBe(true);
  });

  test('parses text/plain JSON and handles it identically', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.0005 }
      }
    });

    const mock = mockMexcSpotFlow({
      symbol: 'BTCUSDC',
      freeQuote: 200,
      price: 40000,
      stepSize: 0.000001,
      minNotional: 5,
      orderId: 'A10002'
    });

    const payload = { symbol: 'BTCUSDC', side: 'SELL', ts: FIXED_TIME_MS };
    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload,
      contentType: 'text/plain'
    });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'SELL',
      tvTs: FIXED_TIME_MS,
      statuses: ['SENT', 'FILLED']
    });

    expect(audit).toBeTruthy();
    expect(String(audit.mexcOrderId)).toBe('A10002');
    expect(mock.scope.isDone()).toBe(true);
  });

  test('rejects invalid text/plain payload with REJECTED audit and no exchange call', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.001 }
      }
    });

    const postOrderScope = nock(MEXC_BASE_URL)
      .post('/api/v3/order')
      .query(true)
      .reply(200, { orderId: 'SHOULD_NOT_HAPPEN' });

    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload: 'not-json',
      contentType: 'text/plain'
    });

    expect(response.status).toBe(200);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      statuses: ['REJECTED']
    });

    expect(audit.status).toBe('REJECTED');
    expect(String(audit.errorMessage || '')).toMatch(/parse webhook json body/i);
    expect(postOrderScope.isDone()).toBe(false);
  });

  test('rejects missing required fields and stores REJECTED audit', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.001 }
      }
    });

    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload: { side: 'BUY', ts: FIXED_TIME_MS },
      contentType: 'application/json'
    });

    expect(response.status).toBe(422);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      statuses: ['REJECTED']
    });

    expect(audit.status).toBe('REJECTED');
    expect(String(audit.errorMessage || '')).toMatch(/symbol is required/i);
  });

  test('suppresses duplicate signal within same minute and avoids second MEXC call', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.0007 }
      }
    });

    const mock = mockMexcSpotFlow({
      symbol: 'BTCUSDC',
      freeQuote: 300,
      price: 60000,
      stepSize: 0.000001,
      minNotional: 5,
      orderId: 'A10003',
      orderStatus: 'NEW'
    });

    const payload = { symbol: 'BTCUSDC', side: 'BUY', ts: FIXED_TIME_MS };
    const first = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload,
      contentType: 'application/json'
    });

    await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'BUY',
      tvTs: FIXED_TIME_MS,
      statuses: ['SENT']
    });

    const second = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload,
      contentType: 'application/json'
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const responses = [first.body?.message, second.body?.message].filter(Boolean);
    expect(responses.includes('duplicate')).toBe(true);

    const audits = await waitFor(async () => {
      const rows = await prisma.executionAudit.findMany({
        where: { userId: seeded.user.id },
        orderBy: { receivedAt: 'asc' }
      });
      return rows.length >= 2 ? rows : null;
    });

    const duplicateRows = audits.filter((row) => String(row.errorMessage || '').toLowerCase().includes('duplicate'));
    expect(duplicateRows.length).toBeGreaterThanOrEqual(1);
    expect(mock.scope.isDone()).toBe(true);
  });

  test('computes BASE qty from riskPctOfFreeQuote with step rounding', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { riskPctOfFreeQuote: 10 }
      }
    });

    const mock = mockMexcSpotFlow({
      symbol: 'BTCUSDC',
      freeQuote: 100,
      price: 25000,
      stepSize: 0.00001,
      minNotional: 5,
      orderId: 'A10004'
    });

    const payload = { symbol: 'BTCUSDC', side: 'BUY', ts: FIXED_TIME_MS };
    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload,
      contentType: 'application/json'
    });

    expect(response.status).toBe(200);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'BUY',
      tvTs: FIXED_TIME_MS,
      statuses: ['SENT', 'FILLED']
    });

    // quoteSpend = 100 * 10% = 10 USDC, qtyRaw = 10 / 25000 = 0.0004, rounded to 0.0004
    expect(Number(audit.qtyRaw)).toBeCloseTo(0.0004, 12);
    expect(Number(audit.qtyRounded)).toBeCloseTo(0.0004, 12);

    const orderQuery = mock.getOrderQuery();
    expect(orderQuery.quantity).toBe('0.0004');
    expect(orderQuery.quoteOrderQty).toBeUndefined();
    expect(orderQuery.amount).toBeUndefined();
    expect(mock.scope.isDone()).toBe(true);
  });

  test('enforces minNotional and rejects without placing MEXC order', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { fixedBaseQty: 0.00001 }
      }
    });

    const sizingScope = mockMexcForSizingOnly({
      symbol: 'BTCUSDC',
      freeQuote: 100,
      price: 100,
      stepSize: 0.000001,
      minNotional: 5
    }).scope;

    const postOrderScope = nock(MEXC_BASE_URL)
      .post('/api/v3/order')
      .query(true)
      .reply(200, { orderId: 'SHOULD_NOT_HAPPEN' });

    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload: { symbol: 'BTCUSDC', side: 'SELL', ts: FIXED_TIME_MS },
      contentType: 'application/json'
    });

    expect(response.status).toBe(200);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'SELL',
      tvTs: FIXED_TIME_MS,
      statuses: ['REJECTED']
    });

    expect(audit.status).toBe('REJECTED');
    expect(String(audit.errorMessage || '')).toMatch(/minNotional/i);
    expect(sizingScope.isDone()).toBe(true);
    expect(postOrderScope.isDone()).toBe(false);
  });

  test('rejects safely when sizing config is missing (no exchange call)', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {}
    });

    const accountScope = nock(MEXC_BASE_URL)
      .get('/api/v3/account')
      .query(true)
      .reply(200, { balances: [{ asset: 'USDC', free: '100', locked: '0' }] });

    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload: { symbol: 'BTCUSDC', side: 'BUY', ts: FIXED_TIME_MS },
      contentType: 'application/json'
    });

    expect(response.status).toBe(200);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'BUY',
      tvTs: FIXED_TIME_MS,
      statuses: ['REJECTED']
    });

    expect(audit.status).toBe('REJECTED');
    expect(String(audit.errorMessage || '')).toMatch(/missing sizing configuration/i);
    expect(accountScope.isDone()).toBe(false);
  });
});
