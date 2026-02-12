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
  waitForExecutionAuditStatus
} from './helpers/tradingviewExecutionTestUtils.js';

const MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const FIXED_TIME_MS = Date.parse('2026-02-12T01:03:13.000Z');

jest.setTimeout(30000);

describe('TradingView sizing floors (minQuoteSpend)', () => {
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

  const minQuoteSpends = [1.05, 3.0, 5.0];

  describe.each(minQuoteSpends)('minQuoteSpend=%s', (minQuoteSpend) => {
    test('BUY uses floor for JSON and text/plain payloads', async () => {
      const seeded = await seedBotSizingConfig({
        sizingConfig: {
          sizingMode: 'BASE',
          baseQtyRule: { riskPctOfFreeQuote: 0.1 },
          minQuoteSpend
        }
      });

      const commonSizing = {
        symbol: 'BTCUSDC',
        freeQuote: 101.96,
        price: 100000,
        stepSize: 0.000001,
        minQty: 0,
        minNotional: 0
      };

      async function runBuyCase({ contentType, ts, orderId }) {
        const mock = mockMexcSpotFlow({
          ...commonSizing,
          orderId
        });

        const payload = { symbol: 'BTCUSDC', side: 'BUY', ts };
        const response = await sendTradingviewWebhook({
          prefix: seeded.prefix,
          secret: seeded.secret,
          payload,
          contentType
        });

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);

        const audit = await waitForExecutionAuditStatus({
          userId: seeded.user.id,
          symbol: 'BTCUSDC',
          side: 'BUY',
          tvTs: ts,
          statuses: ['SENT', 'FILLED']
        });

        expect(audit.status === 'SENT' || audit.status === 'FILLED').toBe(true);
        const debug = audit.sizingDebug || {};
        expect(Number(debug.minQuoteSpend)).toBeCloseTo(minQuoteSpend, 6);
        expect(Number(debug.quoteSpendComputed)).toBeCloseTo(minQuoteSpend, 6);
        expect(Number(debug.qtyAfterStepRounding)).toBeGreaterThan(0);

        const orderQuery = mock.getOrderQuery();
        expect(orderQuery).toBeTruthy();
        expect(orderQuery.quantity).toBeTruthy();
        expect(orderQuery.quoteOrderQty).toBeUndefined();
        expect(orderQuery.amount).toBeUndefined();

        expect(mock.scope.isDone()).toBe(true);
      }

      const suffix = String(minQuoteSpend).replace('.', '');
      await runBuyCase({
        contentType: 'application/json',
        ts: FIXED_TIME_MS,
        orderId: `B${suffix}A`
      });
      await runBuyCase({
        contentType: 'text/plain',
        ts: FIXED_TIME_MS + 60000,
        orderId: `B${suffix}B`
      });
    });

    test('SELL places order when freeBase is available', async () => {
      const seeded = await seedBotSizingConfig({
        sizingConfig: {
          sizingMode: 'BASE',
          baseQtyRule: { riskPctOfFreeQuote: 0.1 },
          minQuoteSpend
        }
      });

      const mock = mockMexcSpotFlow({
        symbol: 'BTCUSDC',
        freeQuote: 101.96,
        freeBase: 0.0001189,
        price: 100000,
        stepSize: 0.000001,
        minQty: 0,
        minNotional: 0,
        orderId: 'SELL-OK'
      });

      const ts = FIXED_TIME_MS;
      const response = await sendTradingviewWebhook({
        prefix: seeded.prefix,
        secret: seeded.secret,
        payload: { symbol: 'BTCUSDC', side: 'SELL', ts },
        contentType: 'application/json'
      });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const audit = await waitForExecutionAuditStatus({
        userId: seeded.user.id,
        symbol: 'BTCUSDC',
        side: 'SELL',
        tvTs: ts,
        statuses: ['SENT', 'FILLED']
      });

      const debug = audit.sizingDebug || {};
      expect(Number(debug.freeBase)).toBeCloseTo(0.0001189, 10);
      expect(Number(debug.qtyAfterStepRounding)).toBeGreaterThan(0);
      expect(debug.rejectedReason).toBeFalsy();

      const orderQuery = mock.getOrderQuery();
      expect(orderQuery).toBeTruthy();
      expect(orderQuery.quantity).toBeTruthy();
      expect(orderQuery.quoteOrderQty).toBeUndefined();
      expect(orderQuery.amount).toBeUndefined();

      expect(mock.scope.isDone()).toBe(true);
    });

    test('SELL rejects when freeBase is zero', async () => {
      const seeded = await seedBotSizingConfig({
        sizingConfig: {
          sizingMode: 'BASE',
          baseQtyRule: { riskPctOfFreeQuote: 0.1 },
          minQuoteSpend
        }
      });

      const sizingScope = mockMexcForSizingOnly({
        symbol: 'BTCUSDC',
        freeQuote: 101.96,
        freeBase: 0,
        price: 100000,
        stepSize: 0.000001,
        minQty: 0,
        minNotional: 0
      }).scope;

      const postOrderScope = nock(MEXC_BASE_URL)
        .post('/api/v3/order')
        .query(true)
        .reply(200, { orderId: 'SHOULD_NOT_HAPPEN' });

      const ts = FIXED_TIME_MS;
      const response = await sendTradingviewWebhook({
        prefix: seeded.prefix,
        secret: seeded.secret,
        payload: { symbol: 'BTCUSDC', side: 'SELL', ts },
        contentType: 'application/json'
      });

      expect(response.status).toBe(200);

      const audit = await waitForExecutionAuditStatus({
        userId: seeded.user.id,
        symbol: 'BTCUSDC',
        side: 'SELL',
        tvTs: ts,
        statuses: ['REJECTED']
      });

      expect(audit.status).toBe('REJECTED');
      expect(audit.sizingDebug?.rejectedReason).toBe('insufficient_base_for_sell');
      expect(sizingScope.isDone()).toBe(true);
      expect(postOrderScope.isDone()).toBe(false);
    });
  });

  test('BUY without floor rejects when rounded quantity is zero', async () => {
    const seeded = await seedBotSizingConfig({
      sizingConfig: {
        sizingMode: 'BASE',
        baseQtyRule: { riskPctOfFreeQuote: 0.01 }
      }
    });

    const sizingScope = mockMexcForSizingOnly({
      symbol: 'BTCUSDC',
      freeQuote: 101.96,
      price: 100000,
      stepSize: 0.000001,
      minQty: 0,
      minNotional: 0
    }).scope;

    const postOrderScope = nock(MEXC_BASE_URL)
      .post('/api/v3/order')
      .query(true)
      .reply(200, { orderId: 'SHOULD_NOT_HAPPEN' });

    const ts = FIXED_TIME_MS;
    const response = await sendTradingviewWebhook({
      prefix: seeded.prefix,
      secret: seeded.secret,
      payload: { symbol: 'BTCUSDC', side: 'BUY', ts },
      contentType: 'application/json'
    });

    expect(response.status).toBe(200);

    const audit = await waitForExecutionAuditStatus({
      userId: seeded.user.id,
      symbol: 'BTCUSDC',
      side: 'BUY',
      tvTs: ts,
      statuses: ['REJECTED']
    });

    const debug = audit.sizingDebug || {};
    expect(audit.status).toBe('REJECTED');
    expect(debug.rejectedReason === 'below_step_size' || Number(debug.qtyAfterStepRounding) === 0).toBe(true);
    expect(sizingScope.isDone()).toBe(true);
    expect(postOrderScope.isDone()).toBe(false);
  });
});
