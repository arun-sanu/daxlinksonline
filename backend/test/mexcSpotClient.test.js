import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSymbolFilters } from '../src/services/mexcSpotClient.js';

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
