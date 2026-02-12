import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTradingviewBodyText } from '../src/middleware/tradingviewBody.js';
import { buildExecutionDedupeKey } from '../src/services/executionAuditService.js';
import {
  SizingConfigError,
  computeBaseQuantityFromInputs,
  normalizeBaseSizingConfig,
  roundDownToStep
} from '../src/services/orderSizingService.js';

test('parseTradingviewBodyText parses text/plain JSON payload', () => {
  const raw = '{"symbol":"BTCUSDC","side":"BUY","ts":1770852000000}';
  const parsed = parseTradingviewBodyText(raw);
  assert.equal(parsed.rawBodyText, raw);
  assert.deepEqual(parsed.payload, {
    symbol: 'BTCUSDC',
    side: 'BUY',
    ts: 1770852000000
  });
});

test('buildExecutionDedupeKey is stable inside same minute and changes per minute', () => {
  const params = { symbol: 'BTCUSDC', side: 'BUY', botId: 'bot-1' };
  const k1 = buildExecutionDedupeKey({ ...params, tvTs: 1770852000123 });
  const k2 = buildExecutionDedupeKey({ ...params, tvTs: 1770852059999 });
  const k3 = buildExecutionDedupeKey({ ...params, tvTs: 1770852060000 });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

test('roundDownToStep rounds quantity down to exchange stepSize', () => {
  assert.equal(roundDownToStep(0.001234, 0.0001), 0.0012);
  assert.equal(roundDownToStep(0.001299, 0.0005), 0.001);
  assert.equal(roundDownToStep(0.00009, 0.0001), 0);
});

test('computeBaseQuantityFromInputs rejects below minNotional after rounding', () => {
  assert.throws(
    () =>
      computeBaseQuantityFromInputs({
        fixedBaseQty: 0.00001,
        freeQuote: 100,
        price: 70000,
        stepSize: 0.000001,
        minNotional: 5,
        minQty: 0
      }),
    /minNotional/i
  );
});

test('normalizeBaseSizingConfig rejects missing sizing config', () => {
  assert.throws(() => normalizeBaseSizingConfig({}, {}), SizingConfigError);
});
