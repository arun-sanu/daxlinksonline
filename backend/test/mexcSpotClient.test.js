import test from 'node:test';
import assert from 'node:assert/strict';

import { createMexcSpotClient, extractSymbolFilters } from '../src/services/mexcSpotClient.js';

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload)
  };
}

function searchParamsToObject(searchParams) {
  const out = {};
  for (const [key, value] of searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

function withFetchMock(mockImpl, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockImpl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.fetch = originalFetch;
    });
}

test('extractSymbolFilters prefers MIN_NOTIONAL filter when present', () => {
  const payload = {
    symbols: [
      {
        symbol: 'BTCUSDC',
        baseAsset: 'BTC',
        quoteAsset: 'USDC',
        baseSizePrecision: '0.000001',
        quoteAmountPrecisionMarket: '1',
        filters: [
          { filterType: 'LOT_SIZE', minQty: '0.000001', stepSize: '0.000001' },
          { filterType: 'MIN_NOTIONAL', minNotional: '5' }
        ]
      }
    ]
  };

  const out = extractSymbolFilters(payload, 'BTCUSDC');
  assert.equal(out.minNotional, 5);
  assert.equal(out.stepSize, 0.000001);
  assert.equal(out.minQty, 0.000001);
});

test('extractSymbolFilters falls back to quoteAmountPrecisionMarket when MIN_NOTIONAL is missing', () => {
  const payload = {
    symbols: [
      {
        symbol: 'BTCUSDC',
        baseAsset: 'BTC',
        quoteAsset: 'USDC',
        baseSizePrecision: '0.000001',
        quoteAmountPrecisionMarket: '1',
        filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.02', askMultiplierDown: '0.02' }]
      }
    ]
  };

  const out = extractSymbolFilters(payload, 'BTCUSDC');
  assert.equal(out.minNotional, 1);
  assert.equal(out.stepSize, 0.000001);
  assert.equal(out.minQty, 0);
});

test('extractSymbolFilters enforces stricter base precision step when baseAssetPrecision is coarser', () => {
  const payload = {
    symbols: [
      {
        symbol: 'ETHUSDC',
        baseAsset: 'ETH',
        quoteAsset: 'USDC',
        baseSizePrecision: '0.000001',
        baseAssetPrecision: 5,
        quotePrecision: 2,
        quoteAmountPrecisionMarket: '1',
        filters: [{ filterType: 'PERCENT_PRICE_BY_SIDE', bidMultiplierUp: '0.02', askMultiplierDown: '0.02' }]
      }
    ]
  };

  const out = extractSymbolFilters(payload, 'ETHUSDC');
  assert.ok(Math.abs(out.stepSize - 0.00001) < 1e-12);
  assert.equal(out.tickSize, 0.01);
  assert.equal(out.quantityPrecision, 5);
  assert.equal(out.pricePrecision, 2);
});

test('placeLimitOrderBaseQty submits LIMIT with GTC and normalized quantity/price', async () => {
  const seen = [];
  const fetchMock = async (url, options = {}) => {
    const parsed = new URL(url);
    seen.push({
      method: options.method || 'GET',
      path: parsed.pathname,
      query: searchParamsToObject(parsed.searchParams),
      headers: options.headers || {}
    });

    if (parsed.pathname === '/api/v3/exchangeInfo') {
      return createJsonResponse({
        symbols: [
          {
            symbol: 'ETHUSDC',
            baseAsset: 'ETH',
            quoteAsset: 'USDC',
            baseSizePrecision: '0.000001',
            baseAssetPrecision: 5,
            quotePrecision: 2,
            filters: [
              { filterType: 'LOT_SIZE', minQty: '0.00001', stepSize: '0.00001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.01' }
            ]
          }
        ]
      });
    }
    if (parsed.pathname === '/api/v3/order') {
      return createJsonResponse({ orderId: '1', status: 'NEW' });
    }
    return createJsonResponse({ msg: 'not found' }, 404);
  };

  await withFetchMock(fetchMock, async () => {
    const client = createMexcSpotClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://example.test'
    });

    await client.placeLimitOrderBaseQty({
      symbol: 'ETHUSDC',
      side: 'BUY',
      quantity: 0.024381086,
      price: 2048.24286625,
      orderType: 'LIMIT',
      newClientOrderId: 'x'.repeat(64)
    });
  });

  const orderRequest = seen.find((entry) => entry.path === '/api/v3/order');
  assert.ok(orderRequest, 'expected order request');
  assert.equal(orderRequest.method, 'POST');
  assert.equal(orderRequest.query.type, 'LIMIT');
  assert.equal(orderRequest.query.timeInForce, 'GTC');
  assert.equal(orderRequest.query.quantity, '0.02438');
  assert.equal(orderRequest.query.price, '2048.24');
  assert.equal(orderRequest.query.newClientOrderId, 'x'.repeat(32));
  assert.ok(orderRequest.query.signature, 'signature should be present');
  assert.ok(orderRequest.query.timestamp, 'timestamp should be present');
  assert.ok(orderRequest.query.recvWindow, 'recvWindow should be present');
});

test('placeLimitOrderBaseQty submits LIMIT_MAKER without GTC and normalizes SELL price upward', async () => {
  const seen = [];
  const fetchMock = async (url, options = {}) => {
    const parsed = new URL(url);
    seen.push({
      method: options.method || 'GET',
      path: parsed.pathname,
      query: searchParamsToObject(parsed.searchParams)
    });

    if (parsed.pathname === '/api/v3/exchangeInfo') {
      return createJsonResponse({
        symbols: [
          {
            symbol: 'ETHUSDC',
            baseAsset: 'ETH',
            quoteAsset: 'USDC',
            baseSizePrecision: '0.000001',
            baseAssetPrecision: 5,
            quotePrecision: 2,
            filters: [
              { filterType: 'LOT_SIZE', minQty: '0.00001', stepSize: '0.00001' },
              { filterType: 'PRICE_FILTER', tickSize: '0.01' }
            ]
          }
        ]
      });
    }
    if (parsed.pathname === '/api/v3/order') {
      return createJsonResponse({ orderId: '2', status: 'NEW' });
    }
    return createJsonResponse({ msg: 'not found' }, 404);
  };

  await withFetchMock(fetchMock, async () => {
    const client = createMexcSpotClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://example.test'
    });

    await client.placeLimitOrderBaseQty({
      symbol: 'ETHUSDC',
      side: 'SELL',
      quantity: 0.024381086,
      price: 2048.241,
      orderType: 'LIMIT_MAKER'
    });
  });

  const orderRequest = seen.find((entry) => entry.path === '/api/v3/order');
  assert.ok(orderRequest, 'expected order request');
  assert.equal(orderRequest.query.type, 'LIMIT_MAKER');
  assert.equal(orderRequest.query.quantity, '0.02438');
  assert.equal(orderRequest.query.price, '2048.25');
  assert.equal(Object.prototype.hasOwnProperty.call(orderRequest.query, 'timeInForce'), false);
});
