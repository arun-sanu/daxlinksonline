import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTradingviewBodyText } from '../src/middleware/tradingviewBody.js';
import { buildExecutionDedupeKey } from '../src/services/executionAuditService.js';
import {
  adjustQuantityUpToMinNotional,
  applyCompoundingToQuoteSpend,
  applySellLadderToSellQuantity,
  classifyMinNotionalShortfall,
  deriveCompoundingBaseQuoteForTargetSpend,
  SizingConfigError,
  computeBaseQuantityFromInputs,
  normalizeBaseSizingConfig,
  resolveEffectiveMinNotional,
  roundDownToStep,
  roundUpToStep
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

test('round step helpers support scientific notation step sizes', () => {
  assert.equal(roundDownToStep(0.123456789, 1e-8), 0.12345678);
  assert.equal(roundUpToStep(0.123456781, 1e-8), 0.12345679);
  assert.equal(roundUpToStep(35.4163895, 1e-7), 35.4163895);
  assert.equal(roundUpToStep(35.41638951, 1e-7), 35.4163896);
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

test('adjustQuantityUpToMinNotional rounds SELL up when one step fixes minNotional', () => {
  const adjusted = adjustQuantityUpToMinNotional({
    qtyRounded: 0.000287,
    computedPrice: 70352.32,
    effectiveMinNotional: 20.2,
    stepSize: 0.000001,
    normalizedSide: 'SELL',
    freeQuote: 13.49824526,
    freeBase: 0.0013769
  });

  assert.equal(adjusted.adjusted, true);
  assert.equal(adjusted.qtyRounded, 0.000288);
  assert.ok(adjusted.notional >= 20.2);
});

test('adjustQuantityUpToMinNotional does not round SELL up past available base', () => {
  const adjusted = adjustQuantityUpToMinNotional({
    qtyRounded: 0.000287,
    computedPrice: 70352.32,
    effectiveMinNotional: 20.2,
    stepSize: 0.000001,
    normalizedSide: 'SELL',
    freeBase: 0.0002875
  });

  assert.equal(adjusted.adjusted, false);
  assert.equal(adjusted.qtyRounded, 0.000287);
  assert.ok(adjusted.notional < 20.2);
});

test('adjustQuantityUpToMinNotional does not round BUY up past available quote', () => {
  const adjusted = adjustQuantityUpToMinNotional({
    qtyRounded: 0.000287,
    computedPrice: 70352.32,
    effectiveMinNotional: 20.2,
    stepSize: 0.000001,
    normalizedSide: 'BUY',
    freeQuote: 20.195
  });

  assert.equal(adjusted.adjusted, false);
  assert.equal(adjusted.qtyRounded, 0.000287);
  assert.ok(adjusted.notional < 20.2);
});

test('applyCompoundingToQuoteSpend profit_only compounds only upside', () => {
  const out = applyCompoundingToQuoteSpend({
    baseQuoteSpend: 10,
    freeQuote: 150,
    compoundingEnabled: true,
    compoundingMode: 'profit_only',
    compoundingBaseQuote: 100,
    compoundingPct: 50
  });
  assert.equal(out.compoundingFactor, 1.25);
  assert.equal(out.quoteSpend, 12.5);
});

test('applyCompoundingToQuoteSpend full_balance can scale down with drawdown', () => {
  const out = applyCompoundingToQuoteSpend({
    baseQuoteSpend: 10,
    freeQuote: 50,
    compoundingEnabled: true,
    compoundingMode: 'full_balance',
    compoundingBaseQuote: 100,
    compoundingPct: 100
  });
  assert.equal(out.compoundingFactor, 0.5);
  assert.equal(out.quoteSpend, 5);
});

test('applyCompoundingToQuoteSpend is disabled by default', () => {
  const out = applyCompoundingToQuoteSpend({
    baseQuoteSpend: 10,
    freeQuote: 250
  });
  assert.equal(out.compoundingFactor, 1);
  assert.equal(out.quoteSpend, 10);
});

test('deriveCompoundingBaseQuoteForTargetSpend matches target spend in full_balance mode', () => {
  const out = deriveCompoundingBaseQuoteForTargetSpend({
    baseQuoteSpend: 131.19923619,
    freeQuote: 291.5538582,
    compoundingEnabled: true,
    compoundingMode: 'full_balance',
    compoundingPct: 100,
    targetSpendRatio: 0.9305
  });
  assert.ok(out !== null);
  assert.ok(Math.abs(out - 141) < 0.01);
});

test('applyCompoundingToQuoteSpend auto-targets spend ratio when targetSpendRatio is provided', () => {
  const out = applyCompoundingToQuoteSpend({
    baseQuoteSpend: 131.19923619,
    freeQuote: 291.5538582,
    compoundingEnabled: true,
    compoundingMode: 'full_balance',
    compoundingPct: 100,
    targetSpendRatio: 0.9305
  });
  assert.equal(out.targetSpendApplied, true);
  assert.ok(Math.abs(out.quoteSpend - 291.5538582 * 0.9305) < 1e-6);
  assert.ok(Math.abs(out.compoundingBaseQuote - 141) < 0.01);
});

test('applyCompoundingToQuoteSpend supports SELL-style profit target spend math', () => {
  const out = applyCompoundingToQuoteSpend({
    baseQuoteSpend: 131.19923619,
    freeQuote: 291.5538582,
    compoundingEnabled: true,
    compoundingMode: 'full_balance',
    compoundingPct: 100,
    targetSpendRatio: 0.9105
  });
  assert.equal(out.targetSpendApplied, true);
  assert.ok(Math.abs(out.quoteSpend - 291.5538582 * 0.9105) < 1e-6);
});

test('applySellLadderToSellQuantity scales up SELL size on profit', () => {
  const out = applySellLadderToSellQuantity({
    qtyRaw: 0.5,
    freeBase: 1,
    marketSellPrice: 110,
    referenceBuyPrice: 100,
    sellLadderEnabled: true,
    sellLadderStrengthPct: 100,
    sellLadderMinFactor: 0.1,
    sellLadderMaxFactor: 2
  });
  assert.equal(out.applied, true);
  assert.ok(Math.abs(out.factor - 1.1) < 1e-12);
  assert.ok(Math.abs(out.qtyRaw - 0.55) < 1e-12);
});

test('applySellLadderToSellQuantity scales down SELL size more aggressively on loss', () => {
  const out = applySellLadderToSellQuantity({
    qtyRaw: 0.5,
    freeBase: 1,
    marketSellPrice: 95,
    referenceBuyPrice: 100,
    sellLadderEnabled: true,
    sellLadderStrengthPct: 100,
    sellLadderMinFactor: 0.1,
    sellLadderMaxFactor: 2
  });
  assert.equal(out.applied, true);
  assert.ok(Math.abs(out.factor - 0.7) < 1e-12);
  assert.ok(Math.abs(out.qtyRaw - 0.35) < 1e-12);
});

test('applySellLadderToSellQuantity caps scaled qty at free base', () => {
  const out = applySellLadderToSellQuantity({
    qtyRaw: 0.9,
    freeBase: 1,
    marketSellPrice: 120,
    referenceBuyPrice: 100,
    sellLadderEnabled: true,
    sellLadderStrengthPct: 200,
    sellLadderMinFactor: 0.1,
    sellLadderMaxFactor: 3
  });
  assert.equal(out.applied, true);
  assert.equal(out.qtyRaw, 1);
});

test('classifyMinNotionalShortfall maps BUY shortfall to quote insufficiency', () => {
  const out = classifyMinNotionalShortfall({
    normalizedSide: 'BUY',
    effectiveMinNotional: 20.2,
    computedPrice: 70352.32,
    stepSize: 0.000001,
    freeQuote: 20.25,
    freeBase: 0
  });
  assert.equal(out.reason, 'insufficient_quote_for_requested_qty');
  assert.ok(out.minNotionalExecutable > 20.25);
});

test('classifyMinNotionalShortfall maps SELL shortfall to base insufficiency', () => {
  const out = classifyMinNotionalShortfall({
    normalizedSide: 'SELL',
    effectiveMinNotional: 20.2,
    computedPrice: 70352.32,
    stepSize: 0.000001,
    freeQuote: 0,
    freeBase: 0.0002879
  });
  assert.equal(out.reason, 'insufficient_base_for_requested_qty');
  assert.equal(out.minQtyExecutable, 0.000288);
});

test('classifyMinNotionalShortfall keeps below_min_notional when balances can satisfy executable min', () => {
  const out = classifyMinNotionalShortfall({
    normalizedSide: 'SELL',
    effectiveMinNotional: 20.2,
    computedPrice: 70352.32,
    stepSize: 0.000001,
    freeQuote: 100,
    freeBase: 0.001
  });
  assert.equal(out.reason, 'below_min_notional');
  assert.equal(out.minQtyExecutable, 0.000288);
});

test('resolveEffectiveMinNotional applies minQuoteSpend floor only to BUY', () => {
  const buyFloor = resolveEffectiveMinNotional({
    normalizedSide: 'BUY',
    exchangeMinNotional: 0,
    minQuoteSpend: 1.2
  });
  const sellFloor = resolveEffectiveMinNotional({
    normalizedSide: 'SELL',
    exchangeMinNotional: 0,
    minQuoteSpend: 1.2
  });

  assert.equal(buyFloor, 1.2);
  assert.equal(sellFloor, 0);
});
