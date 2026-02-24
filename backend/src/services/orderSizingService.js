import { prisma } from '../utils/prisma.js';

export class SizingConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SizingConfigError';
    this.status = 422;
  }
}

function stepDecimals(stepNum) {
  const stepString = String(stepNum || '').trim().toLowerCase();
  if (!stepString) return 0;

  if (stepString.includes('e-')) {
    const [coeff, expPart] = stepString.split('e-');
    const exp = Number(expPart);
    if (!Number.isFinite(exp) || exp <= 0) return 0;
    const coeffDecimals = coeff.includes('.') ? coeff.split('.')[1].replace(/0+$/, '').length : 0;
    return exp + coeffDecimals;
  }

  if (stepString.includes('.')) {
    return stepString.split('.')[1].replace(/0+$/, '').length;
  }

  return 0;
}

function normalizeCompoundingMode(value, sizingMode = 'balance_pct') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'profit_only' || normalized === 'full_balance') return normalized;
  return sizingMode === 'fixed_quote' ? 'profit_only' : 'full_balance';
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return asNumber(value);
}

function firstObject(candidates = []) {
  return candidates.find((item) => item && typeof item === 'object') || null;
}

function quoteAssetFromSymbol(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  if (normalized.endsWith('USDC')) return 'USDC';
  if (normalized.endsWith('USDT')) return 'USDT';
  return null;
}

function baseAssetFromSymbol(symbol, quoteAsset) {
  const normalized = String(symbol || '').toUpperCase();
  const quote = String(quoteAsset || '').toUpperCase();
  if (!normalized || !quote || !normalized.endsWith(quote)) return null;
  const base = normalized.slice(0, -quote.length).trim();
  return base || null;
}

function toFiniteOrZero(value) {
  const n = asNumber(value);
  return n && n > 0 ? n : 0;
}

// SELL ladder is intentionally asymmetric:
// when price is below reference BUY, reduce size faster (loss slope multiplier).
const SELL_LADDER_LOSS_SLOPE_MULTIPLIER = 6;
const DEFAULT_MEXC_SELL_PROFIT_TARGET_SPEND_PCT = 91.05;

export function resolveEffectiveMinNotional({
  normalizedSide = null,
  exchangeMinNotional = 0,
  minQuoteSpend = 0,
  minSellNotional = 0
}) {
  const side = String(normalizedSide || '').trim().toUpperCase();
  const exchangeFloor = toFiniteOrZero(exchangeMinNotional);
  // Internal minQuoteSpend floor is a BUY-side sizing control, not a SELL exchange rule.
  const buySideFloor = side === 'BUY' ? toFiniteOrZero(minQuoteSpend) : 0;
  const sellSideFloor = side === 'SELL' ? toFiniteOrZero(minSellNotional) : 0;
  return Math.max(exchangeFloor, buySideFloor, sellSideFloor);
}

function throwSizingError(message, sizingDebug, rejectedReason) {
  const error = new SizingConfigError(message);
  error.sizingDebug = {
    ...(sizingDebug && typeof sizingDebug === 'object' ? sizingDebug : {}),
    rejectedReason: rejectedReason || 'sizing_error'
  };
  throw error;
}

function normalizeSellMode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SELL_FIXED_QTY' || normalized === 'SELL_PCT' || normalized === 'SELL_ALL') {
    return normalized;
  }
  return 'SELL_ALL';
}

export function roundDownToStep(value, stepSize) {
  const valueNum = asNumber(value);
  if (!valueNum || valueNum <= 0) return 0;
  const stepNum = asNumber(stepSize);
  if (!stepNum || stepNum <= 0) return valueNum;
  const decimals = stepDecimals(stepNum);
  const safeDecimals = Math.max(0, Math.min(decimals, 12));
  const scale = 10 ** safeDecimals;
  const stepScaled = Math.round(stepNum * scale);
  if (!stepScaled || stepScaled <= 0) return Number(valueNum.toFixed(safeDecimals));
  const valueScaled = valueNum * scale;
  const flooredScaled = Math.floor((valueScaled + 1e-6) / stepScaled) * stepScaled;
  return Number((flooredScaled / scale).toFixed(safeDecimals));
}

export function roundUpToStep(value, stepSize) {
  const valueNum = asNumber(value);
  if (!valueNum || valueNum <= 0) return 0;
  const stepNum = asNumber(stepSize);
  if (!stepNum || stepNum <= 0) return valueNum;
  const decimals = stepDecimals(stepNum);
  const safeDecimals = Math.max(0, Math.min(decimals, 12));
  const scale = 10 ** safeDecimals;
  const stepScaled = Math.round(stepNum * scale);
  if (!stepScaled || stepScaled <= 0) return Number(valueNum.toFixed(safeDecimals));
  const valueScaled = valueNum * scale;
  const ceiledScaled = Math.ceil((valueScaled - 1e-6) / stepScaled) * stepScaled;
  return Number((ceiledScaled / scale).toFixed(safeDecimals));
}

export function normalizeBaseSizingConfig(rawConfig = {}) {
  const baseRule = rawConfig?.baseQtyRule && typeof rawConfig.baseQtyRule === 'object' ? rawConfig.baseQtyRule : rawConfig;
  const mode = String(rawConfig?.sizingMode || rawConfig?.mode || '').trim().toUpperCase();
  if (mode && mode !== 'BASE') {
    throw new SizingConfigError(`Unsupported sizingMode "${mode}". Only BASE mode is supported.`);
  }
  const fixedBaseQty = asNumber(baseRule?.fixedBaseQty);
  const riskPctOfFreeQuote = asNumber(baseRule?.riskPctOfFreeQuote);
  const minQuoteSpend = asNumber(
    baseRule?.minQuoteSpend ??
    rawConfig?.minQuoteSpend
  );
  const sellMode = normalizeSellMode(baseRule?.sellMode ?? rawConfig?.sellMode);
  const sellFixedBaseQty = asNumber(
    baseRule?.sellFixedBaseQty ??
    rawConfig?.sellFixedBaseQty
  );
  const sellPctOfFreeBase = asNumber(
    rawConfig?.sellPctOfFreeBase ??
    rawConfig?.sellPct ??
    baseRule?.sellPctOfFreeBase ??
    baseRule?.sellPct
  );

  const hasFixed = fixedBaseQty !== null && fixedBaseQty > 0;
  const hasRiskPct = riskPctOfFreeQuote !== null && riskPctOfFreeQuote > 0;
  if (!hasFixed && !hasRiskPct) {
    throw new SizingConfigError(
      'Missing sizing configuration. Configure Trade Bots runtime sizing for the linked integration.'
    );
  }

  return {
    sizingMode: 'BASE',
    fixedBaseQty: hasFixed ? fixedBaseQty : null,
    riskPctOfFreeQuote: hasRiskPct ? riskPctOfFreeQuote : null,
    // Internal floor for BUY quote spend calculations (not exchange minNotional).
    minQuoteSpend: minQuoteSpend !== null && minQuoteSpend > 0 ? minQuoteSpend : null,
    sellMode,
    sellFixedBaseQty: sellFixedBaseQty !== null && sellFixedBaseQty > 0 ? sellFixedBaseQty : null,
    sellPctOfFreeBase: sellPctOfFreeBase !== null && sellPctOfFreeBase > 0 ? sellPctOfFreeBase : null
  };
}

export function computeBaseQuantityFromInputs({
  fixedBaseQty = null,
  riskPctOfFreeQuote = null,
  minQuoteSpend = null,
  freeQuote,
  price,
  stepSize,
  minNotional = 0,
  minQty = 0,
  sizingDebugBase = {}
}) {
  const safePrice = asNumber(price);
  const safeFreeQuote = asNumber(freeQuote);
  const stepSizeNum = toFiniteOrZero(stepSize);
  const minQtyNum = toFiniteOrZero(minQty);
  const minNotionalNum = toFiniteOrZero(minNotional);

  const sizingDebug = {
    ...(sizingDebugBase && typeof sizingDebugBase === 'object' ? sizingDebugBase : {}),
    freeQuote: safeFreeQuote || 0,
    priceUsed: safePrice,
    fixedBaseQty: asNullableNumber(fixedBaseQty),
    riskPctOfFreeQuote: asNullableNumber(riskPctOfFreeQuote),
    minQuoteSpend: asNullableNumber(minQuoteSpend),
    qtyRaw: null,
    quoteSpendComputed: null,
    stepSize: stepSizeNum,
    minQty: minQtyNum,
    minNotional: minNotionalNum,
    qtyAfterStepRounding: null,
    notionalAfterRounding: null,
    rejectedReason: null
  };

  if (!safePrice || safePrice <= 0) {
    throwSizingError('Cannot compute quantity without a valid market price.', sizingDebug, 'invalid_price');
  }

  let qtyRaw = null;
  let quoteSpendComputed = null;
  if (fixedBaseQty !== null && fixedBaseQty !== undefined) {
    const fixed = asNumber(fixedBaseQty);
    if (!fixed || fixed <= 0) {
      throwSizingError('fixedBaseQty must be greater than 0.', sizingDebug, 'invalid_fixed_base_qty');
    }
    qtyRaw = fixed;
  } else {
    if (!safeFreeQuote || safeFreeQuote <= 0) {
      throwSizingError(
        'Cannot compute quantity because free quote balance is zero.',
        sizingDebug,
        'free_quote_unavailable'
      );
    }
    const pct = asNumber(riskPctOfFreeQuote);
    if (!pct || pct <= 0) {
      throwSizingError('riskPctOfFreeQuote must be greater than 0.', sizingDebug, 'invalid_risk_pct');
    }
    quoteSpendComputed = safeFreeQuote * (pct / 100);
    const minQuoteFloor = toFiniteOrZero(minQuoteSpend);
    if (minQuoteFloor > 0) {
      // Internal safety floor only; exchange minNotional rules still apply below.
      quoteSpendComputed = Math.max(quoteSpendComputed, minQuoteFloor);
    }
    qtyRaw = quoteSpendComputed / safePrice;
  }

  sizingDebug.qtyRaw = asNumber(qtyRaw);
  sizingDebug.quoteSpendComputed = asNullableNumber(quoteSpendComputed);

  const qtyRounded = roundDownToStep(qtyRaw, stepSizeNum);
  sizingDebug.qtyAfterStepRounding = asNumber(qtyRounded) || 0;
  const notional = qtyRounded * safePrice;
  sizingDebug.notionalAfterRounding = asNumber(notional) || 0;
  if (!qtyRounded || qtyRounded <= 0) {
    throwSizingError(
      'Computed quantity is zero after applying step size rounding.',
      sizingDebug,
      'below_step_size'
    );
  }

  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    throwSizingError(
      `Quantity ${qtyRounded} is below exchange minQty ${minQtyNum}.`,
      sizingDebug,
      'below_min_qty'
    );
  }

  if (minNotionalNum > 0 && notional < minNotionalNum) {
    throwSizingError(
      `Order value ${notional} is below exchange minNotional ${minNotionalNum}.`,
      sizingDebug,
      'below_min_notional'
    );
  }

  return {
    qtyRaw,
    qtyRounded,
    notional,
    quoteSpendComputed,
    sizingDebug
  };
}

function computeSellQuantityFromInputs({
  freeBase,
  sellMode = 'SELL_ALL',
  sellFixedBaseQty = null,
  sellPctOfFreeBase = null,
  price,
  stepSize,
  minNotional = 0,
  minQty = 0,
  sizingDebugBase = {}
}) {
  const safePrice = asNumber(price);
  const safeFreeBase = asNumber(freeBase);
  const stepSizeNum = toFiniteOrZero(stepSize);
  const minQtyNum = toFiniteOrZero(minQty);
  const minNotionalNum = toFiniteOrZero(minNotional);

  const sizingDebug = {
    ...(sizingDebugBase && typeof sizingDebugBase === 'object' ? sizingDebugBase : {}),
    freeBase: safeFreeBase || 0,
    priceUsed: safePrice,
    sellMode,
    sellFixedBaseQty: asNullableNumber(sellFixedBaseQty),
    sellPctOfFreeBase: asNullableNumber(sellPctOfFreeBase),
    qtyRaw: null,
    quoteSpendComputed: null,
    stepSize: stepSizeNum,
    minQty: minQtyNum,
    minNotional: minNotionalNum,
    qtyAfterStepRounding: null,
    notionalAfterRounding: null,
    rejectedReason: null
  };

  if (!safePrice || safePrice <= 0) {
    throwSizingError('Cannot compute sell quantity without a valid market price.', sizingDebug, 'invalid_price');
  }

  if (!safeFreeBase || safeFreeBase <= 0) {
    sizingDebug.qtyRaw = 0;
    sizingDebug.qtyAfterStepRounding = 0;
    sizingDebug.quoteSpendComputed = 0;
    sizingDebug.notionalAfterRounding = 0;
    throwSizingError(
      'Cannot compute sell quantity because free base balance is zero.',
      sizingDebug,
      'insufficient_base_for_sell'
    );
  }

  let qtyRaw = safeFreeBase;
  if (sellMode === 'SELL_FIXED_QTY') {
    const fixed = asNumber(sellFixedBaseQty);
    if (!fixed || fixed <= 0) {
      throwSizingError('sellFixedBaseQty must be greater than 0.', sizingDebug, 'invalid_sell_fixed_qty');
    }
    qtyRaw = Math.min(safeFreeBase, fixed);
  } else if (sellMode === 'SELL_PCT') {
    const pct = asNumber(sellPctOfFreeBase);
    if (!pct || pct <= 0) {
      throwSizingError('sellPctOfFreeBase must be greater than 0.', sizingDebug, 'invalid_sell_pct');
    }
    qtyRaw = safeFreeBase * (pct / 100);
  }

  sizingDebug.qtyRaw = asNumber(qtyRaw);

  const qtyRounded = roundDownToStep(qtyRaw, stepSizeNum);
  sizingDebug.qtyAfterStepRounding = asNumber(qtyRounded) || 0;
  const notional = qtyRounded * safePrice;
  sizingDebug.notionalAfterRounding = asNumber(notional) || 0;
  if (!qtyRounded || qtyRounded <= 0) {
    throwSizingError(
      'Computed sell quantity is zero after applying step size rounding.',
      sizingDebug,
      'below_step_size'
    );
  }

  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    throwSizingError(
      `Quantity ${qtyRounded} is below exchange minQty ${minQtyNum}.`,
      sizingDebug,
      'below_min_qty'
    );
  }

  if (minNotionalNum > 0 && notional < minNotionalNum) {
    throwSizingError(
      `Order value ${notional} is below exchange minNotional ${minNotionalNum}.`,
      sizingDebug,
      'below_min_notional'
    );
  }

  return {
    qtyRaw,
    qtyRounded,
    notional,
    quoteSpendComputed: null,
    sizingDebug
  };
}

function extractSizingConfigFromWorkflow(workflowConfig = {}) {
  const candidates = [
    workflowConfig?.tradingviewExecution?.sizing,
    workflowConfig?.orderExecution?.sizing,
    workflowConfig?.execution?.sizing,
    workflowConfig?.orders?.sizing,
    workflowConfig?.sizing,
    workflowConfig?.tradingviewExecution,
    workflowConfig?.orderExecution,
    workflowConfig?.execution,
    workflowConfig?.orders
  ];
  return firstObject(candidates) || null;
}

export async function resolveWorkspaceSizingConfig(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, workflowConfig: true }
  });
  if (!workspace) {
    throw new SizingConfigError('Workspace not found while resolving sizing config.');
  }

  const workflowConfig = workspace.workflowConfig || {};
  const dbConfig = extractSizingConfigFromWorkflow(workflowConfig);
  return normalizeBaseSizingConfig(dbConfig || {});
}

function clamp(value, min, max) {
  const n = asNumber(value);
  if (n === null) return null;
  const minNum = asNumber(min);
  const maxNum = asNumber(max);
  let out = n;
  if (minNum !== null) out = Math.max(out, minNum);
  if (maxNum !== null) out = Math.min(out, maxNum);
  return out;
}

function normalizeReferencePriceSource(value) {
  const normalized = String(value || 'last').trim().toLowerCase();
  if (normalized === 'mark' || normalized === 'mid' || normalized === 'last') return normalized;
  return 'last';
}

function normalizeRuntimeSizingMode(value) {
  const normalized = String(value || 'balance_pct').trim().toLowerCase();
  if (['balance_pct', 'fixed_quote', 'risk_per_trade_pct', 'volatility_adjusted'].includes(normalized)) {
    return normalized;
  }
  return 'balance_pct';
}

function normalizeTargetSpendPct(value, label = 'targetSpendPct') {
  const targetSpendPctRaw = asNumber(value);
  if (targetSpendPctRaw === null) return null;
  const normalizedTarget = targetSpendPctRaw <= 1 ? targetSpendPctRaw * 100 : targetSpendPctRaw;
  if (normalizedTarget <= 0 || normalizedTarget > 100) {
    throw new SizingConfigError(`Trade Bot ${label} must be greater than 0 and at most 100.`);
  }
  return normalizedTarget;
}

function isMexcMacdBollingerRuntimeRules(rawRules = {}) {
  if (!rawRules || typeof rawRules !== 'object') return false;
  const exchange = String(rawRules?.exchange || '').trim().toUpperCase();
  if (exchange !== 'MEXC') return false;
  const strategy = String(rawRules?.strategy || '').trim().toLowerCase();
  return strategy.includes('macd') && strategy.includes('bollinger');
}

export function applyCompoundingToQuoteSpend({
  baseQuoteSpend,
  freeQuote,
  compoundingEnabled = false,
  compoundingMode = 'full_balance',
  compoundingBaseQuote = null,
  compoundingPct = 100,
  targetSpendRatio = null
}) {
  const baseSpend = asNumber(baseQuoteSpend);
  const freeQuoteNum = asNumber(freeQuote) || 0;
  const pct = clamp(compoundingPct, 0, 300);
  const strength = pct === null ? 1 : pct / 100;
  const targetRatio = asNumber(targetSpendRatio);

  if (!baseSpend || baseSpend <= 0) {
    return {
      quoteSpend: 0,
      baseQuoteSpend: 0,
      compoundingFactor: 1,
      compoundingProfitQuote: 0,
      compoundingBaseQuote: asNumber(compoundingBaseQuote) || 0,
      targetSpendRatio: targetRatio && targetRatio > 0 ? targetRatio : null,
      targetSpendApplied: false
    };
  }

  const inferredBaseQuote = compoundingMode === 'full_balance'
    ? (freeQuoteNum > 0 ? freeQuoteNum : baseSpend)
    : baseSpend;
  const autoBaseQuote = deriveCompoundingBaseQuoteForTargetSpend({
    baseQuoteSpend: baseSpend,
    freeQuote: freeQuoteNum,
    compoundingEnabled,
    compoundingMode,
    compoundingPct,
    targetSpendRatio: targetRatio
  });
  const baseQuote = toFiniteOrZero(autoBaseQuote) || toFiniteOrZero(compoundingBaseQuote) || inferredBaseQuote;
  const profitQuote = Math.max(0, freeQuoteNum - baseQuote);

  if (!compoundingEnabled || strength <= 0 || baseQuote <= 0) {
    return {
      quoteSpend: baseSpend,
      baseQuoteSpend: baseSpend,
      compoundingFactor: 1,
      compoundingProfitQuote: profitQuote,
      compoundingBaseQuote: baseQuote,
      targetSpendRatio: targetRatio && targetRatio > 0 ? targetRatio : null,
      targetSpendApplied: false
    };
  }

  let factor = 1;
  if (compoundingMode === 'profit_only') {
    factor = 1 + (profitQuote / baseQuote) * strength;
  } else {
    const balanceRatio = Math.max(0, freeQuoteNum / baseQuote);
    factor = 1 + (balanceRatio - 1) * strength;
    factor = Math.max(0, factor);
  }

  return {
    quoteSpend: baseSpend * factor,
    baseQuoteSpend: baseSpend,
    compoundingFactor: factor,
    compoundingProfitQuote: profitQuote,
    compoundingBaseQuote: baseQuote,
    targetSpendRatio: targetRatio && targetRatio > 0 ? targetRatio : null,
    targetSpendApplied: toFiniteOrZero(autoBaseQuote) > 0
  };
}

export function deriveCompoundingBaseQuoteForTargetSpend({
  baseQuoteSpend,
  freeQuote,
  compoundingEnabled = false,
  compoundingMode = 'full_balance',
  compoundingPct = 100,
  targetSpendRatio = null
}) {
  const baseSpend = asNumber(baseQuoteSpend);
  const freeQuoteNum = asNumber(freeQuote) || 0;
  const ratio = asNumber(targetSpendRatio);
  const pct = clamp(compoundingPct, 0, 300);
  const strength = pct === null ? 1 : pct / 100;

  if (!compoundingEnabled || compoundingMode !== 'full_balance') return null;
  if (!baseSpend || baseSpend <= 0 || !freeQuoteNum || freeQuoteNum <= 0) return null;
  if (!ratio || ratio <= 0) return null;
  if (strength <= 0) return null;

  const targetSpend = freeQuoteNum * ratio;
  const requiredFactor = targetSpend / baseSpend;
  const denominator = requiredFactor - 1 + strength;
  if (!denominator || denominator <= 0) return null;

  const baseQuote = (strength * freeQuoteNum) / denominator;
  return baseQuote > 0 ? baseQuote : null;
}

function resolveTradeExecutionPrice(row = null) {
  if (!row || typeof row !== 'object') return null;
  const explicit = asNumber(row.executionPrice);
  if (explicit && explicit > 0) return explicit;
  const market = asNumber(row.marketPrice);
  if (market && market > 0) return market;
  const quoteValue = asNumber(row.value);
  const qty = asNumber(row.quantity);
  if (quoteValue && quoteValue > 0 && qty && qty > 0) return quoteValue / qty;
  return null;
}

async function resolveSellLadderReferenceBuyPrice({
  workspaceId,
  integrationId,
  symbol
}) {
  const normalizedWorkspaceId = String(workspaceId || '').trim();
  const normalizedIntegrationId = String(integrationId || '').trim();
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedWorkspaceId || !normalizedIntegrationId || !normalizedSymbol) return null;

  const latestBuy = await prisma.tradeTransaction.findFirst({
    where: {
      workspaceId: normalizedWorkspaceId,
      integrationId: normalizedIntegrationId,
      symbol: normalizedSymbol,
      side: { in: ['BUY', 'LONG'] },
      status: { in: ['filled', 'executed', 'executed_success', 'success', 'closed'] }
    },
    orderBy: [{ executedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      executionPrice: true,
      marketPrice: true,
      value: true,
      quantity: true
    }
  });

  const referencePrice = resolveTradeExecutionPrice(latestBuy);
  return referencePrice && referencePrice > 0 ? referencePrice : null;
}

export function applySellLadderToSellQuantity({
  qtyRaw,
  freeBase,
  marketSellPrice,
  referenceBuyPrice,
  sellLadderEnabled = false,
  sellLadderStrengthPct = 100,
  sellLadderMinFactor = 0.1,
  sellLadderMaxFactor = 2
}) {
  const baseQty = asNumber(qtyRaw);
  const freeBaseNum = asNumber(freeBase) || 0;
  const marketPriceNum = asNumber(marketSellPrice);
  const referenceBuyNum = asNumber(referenceBuyPrice);
  const strengthPct = clamp(sellLadderStrengthPct, 0, 500);
  const strength = strengthPct === null ? 1 : strengthPct / 100;
  const minFactorRaw = clamp(sellLadderMinFactor, 0.01, 1);
  const minFactor = minFactorRaw === null ? 0.1 : minFactorRaw;
  const maxFactorRaw = clamp(sellLadderMaxFactor, 1, 10);
  const maxFactor = Math.max(minFactor, maxFactorRaw === null ? 2 : maxFactorRaw);

  if (!baseQty || baseQty <= 0) {
    return {
      qtyRaw: 0,
      factor: 1,
      edgeRatio: null,
      referenceBuyPrice: referenceBuyNum,
      marketSellPrice: marketPriceNum,
      applied: false
    };
  }

  if (
    !sellLadderEnabled ||
    !marketPriceNum ||
    marketPriceNum <= 0 ||
    !referenceBuyNum ||
    referenceBuyNum <= 0 ||
    strength <= 0
  ) {
    return {
      qtyRaw: baseQty,
      factor: 1,
      edgeRatio: null,
      referenceBuyPrice: referenceBuyNum,
      marketSellPrice: marketPriceNum,
      applied: false
    };
  }

  const edgeRatio = (marketPriceNum - referenceBuyNum) / referenceBuyNum;
  const slope = edgeRatio >= 0 ? strength : strength * SELL_LADDER_LOSS_SLOPE_MULTIPLIER;
  const rawFactor = 1 + edgeRatio * slope;
  const factor = Math.max(minFactor, Math.min(maxFactor, rawFactor));
  const scaledQty = Math.max(0, Math.min(freeBaseNum, baseQty * factor));

  return {
    qtyRaw: scaledQty,
    factor,
    edgeRatio,
    referenceBuyPrice: referenceBuyNum,
    marketSellPrice: marketPriceNum,
    applied: true
  };
}

export function classifyMinNotionalShortfall({
  normalizedSide = null,
  effectiveMinNotional = 0,
  computedPrice = 0,
  stepSize = 0,
  freeQuote = 0,
  freeBase = 0
}) {
  const side = String(normalizedSide || '').trim().toUpperCase();
  const minNotional = toFiniteOrZero(effectiveMinNotional);
  const price = asNumber(computedPrice) || 0;
  const step = toFiniteOrZero(stepSize);
  const quote = asNumber(freeQuote) || 0;
  const base = asNumber(freeBase) || 0;

  if (!minNotional || !price) return null;

  const minQtyRaw = minNotional / price;
  const minQtyExecutable = step > 0 ? roundUpToStep(minQtyRaw, step) : minQtyRaw;
  const minNotionalExecutable = minQtyExecutable * price;

  if (side === 'BUY' && quote + 1e-12 < minNotionalExecutable) {
    return {
      reason: 'insufficient_quote_for_requested_qty',
      minQtyExecutable,
      minNotionalExecutable
    };
  }

  if (side === 'SELL' && base + 1e-12 < minQtyExecutable) {
    return {
      reason: 'insufficient_base_for_requested_qty',
      minQtyExecutable,
      minNotionalExecutable
    };
  }

  return {
    reason: 'below_min_notional',
    minQtyExecutable,
    minNotionalExecutable
  };
}

function extractTradeBotRuntimeSizingForIntegration(workflowConfig = {}, integrationId) {
  const wantedIntegrationId = String(integrationId || '').trim();
  if (!wantedIntegrationId) return null;
  const runtimeConfigs = workflowConfig?.tradeBots?.runtimeConfigs;
  if (!runtimeConfigs || typeof runtimeConfigs !== 'object' || Array.isArray(runtimeConfigs)) return null;

  for (const [botId, entry] of Object.entries(runtimeConfigs)) {
    if (!entry || typeof entry !== 'object') continue;
    const linkedIntegrationId = String(entry?.links?.integrationId || '').trim();
    if (!linkedIntegrationId) continue;
    if (linkedIntegrationId !== wantedIntegrationId) continue;
    const rules = entry?.rules && typeof entry.rules === 'object' ? entry.rules : null;
    if (!rules) continue;
    return {
      botId,
      rules
    };
  }
  return null;
}

function normalizeTradeBotRuntimeSizingConfig(rawRules = {}) {
  if (!rawRules || typeof rawRules !== 'object') {
    throw new SizingConfigError('Missing Trade Bot runtime rules for sizing.');
  }
  const mexcMacdBollingerRules = isMexcMacdBollingerRuntimeRules(rawRules);
  const sizingMode = normalizeRuntimeSizingMode(rawRules?.sizingMode);
  const allocationValue = asNumber(rawRules?.allocationValue);
  if (allocationValue === null || allocationValue < 0) {
    throw new SizingConfigError('Trade Bot allocationValue is required and must be >= 0.');
  }
  const reinvestmentPctRaw = asNumber(rawRules?.reinvestmentPct);
  const reinvestmentPct = reinvestmentPctRaw === null ? 100 : Math.max(0, Math.min(100, reinvestmentPctRaw));
  const minQuoteSpendRaw = asNumber(rawRules?.minQuoteSpend);
  const maxQuoteSpendRaw = asNumber(rawRules?.maxQuoteSpend);
  const minQuoteSpend = minQuoteSpendRaw !== null && minQuoteSpendRaw > 0 ? minQuoteSpendRaw : 0;
  const maxQuoteSpend = maxQuoteSpendRaw !== null && maxQuoteSpendRaw > 0 ? Math.max(maxQuoteSpendRaw, minQuoteSpend) : null;
  const codeParameters =
    rawRules?.codeParameters && typeof rawRules.codeParameters === 'object' ? rawRules.codeParameters : {};
  const codeMinSellNotionalRaw = asNumber(codeParameters?.min_sell_usdc);
  const minSellNotionalRaw = asNumber(
    rawRules?.minSellNotional ??
    rawRules?.minSellUsdc ??
    codeMinSellNotionalRaw ??
    rawRules?.minQuoteSpend
  );
  const minSellNotional = minSellNotionalRaw !== null && minSellNotionalRaw > 0 ? minSellNotionalRaw : 0;
  const compoundingEnabled =
    rawRules?.compoundingEnabled === true ||
    rawRules?.reinvestProfits === true ||
    rawRules?.reinvestProfitsEnabled === true;
  const compoundingMode = normalizeCompoundingMode(
    rawRules?.compoundingMode ?? rawRules?.compoundMode,
    sizingMode
  );
  const compoundingBaseQuoteRaw = asNumber(
    rawRules?.compoundingBaseQuote ??
    rawRules?.compoundBaseQuote ??
    rawRules?.reinvestBaseQuote
  );
  const compoundingBaseQuote = compoundingBaseQuoteRaw !== null && compoundingBaseQuoteRaw > 0 ? compoundingBaseQuoteRaw : null;
  const compoundingPctRaw = asNumber(
    rawRules?.compoundingPct ??
    rawRules?.compoundPct ??
    rawRules?.reinvestProfitsPct
  );
  const compoundingPct = compoundingPctRaw === null ? 100 : clamp(compoundingPctRaw, 0, 300);
  const targetSpendPctRaw =
    rawRules?.targetSpendPct ??
    rawRules?.targetSpendPercent ??
    rawRules?.targetQuoteSpendPct ??
    rawRules?.targetQuoteSpendPercent;
  const targetSpendPct = normalizeTargetSpendPct(targetSpendPctRaw, 'targetSpendPct');

  const sellCompoundingConfig =
    rawRules?.sellCompounding && typeof rawRules.sellCompounding === 'object' ? rawRules.sellCompounding : {};
  const sellCompoundingEnabledRaw =
    rawRules?.sellCompoundingEnabled ??
    (typeof sellCompoundingConfig?.enabled === 'boolean' ? sellCompoundingConfig.enabled : undefined) ??
    (rawRules?.sellCompounding === true ? true : rawRules?.sellCompounding === false ? false : undefined);
  const sellCompoundingEnabled = sellCompoundingEnabledRaw === null || sellCompoundingEnabledRaw === undefined
    ? mexcMacdBollingerRules
    : sellCompoundingEnabledRaw === true;
  let sellCompoundingMode = normalizeCompoundingMode(
    rawRules?.sellCompoundingMode ??
    rawRules?.sellCompoundMode ??
    sellCompoundingConfig?.mode,
    sizingMode
  );
  const sellCompoundingBaseQuoteRaw = asNumber(
    rawRules?.sellCompoundingBaseQuote ??
    rawRules?.sellCompoundBaseQuote ??
    sellCompoundingConfig?.baseQuote ??
    rawRules?.compoundingBaseQuote
  );
  const sellCompoundingBaseQuote =
    sellCompoundingBaseQuoteRaw !== null && sellCompoundingBaseQuoteRaw > 0
      ? sellCompoundingBaseQuoteRaw
      : null;
  const sellCompoundingPctRaw = asNumber(
    rawRules?.sellCompoundingPct ??
    rawRules?.sellCompoundPct ??
    sellCompoundingConfig?.pct ??
    compoundingPct
  );
  const sellCompoundingPct = sellCompoundingPctRaw === null ? 100 : clamp(sellCompoundingPctRaw, 0, 300);
  const sellTargetSpendPctRaw =
    rawRules?.sellTargetSpendPct ??
    rawRules?.sellTargetSpendPercent ??
    sellCompoundingConfig?.targetSpendPct ??
    sellCompoundingConfig?.targetSpendPercent ??
    (mexcMacdBollingerRules ? DEFAULT_MEXC_SELL_PROFIT_TARGET_SPEND_PCT : null);
  const sellTargetSpendPct = normalizeTargetSpendPct(sellTargetSpendPctRaw, 'sellTargetSpendPct');
  if (sellTargetSpendPct !== null && sellCompoundingMode !== 'full_balance') {
    sellCompoundingMode = 'full_balance';
  }

  const sellLadderConfig =
    rawRules?.sellLadder && typeof rawRules.sellLadder === 'object' ? rawRules.sellLadder : {};
  const sellLadderEnabled =
    rawRules?.sellLadderEnabled === true ||
    rawRules?.sellLadder === true ||
    sellLadderConfig?.enabled === true;
  const sellLadderStrengthPctRaw = asNumber(
    rawRules?.sellLadderStrengthPct ??
    rawRules?.sellLadderStrength ??
    sellLadderConfig?.strengthPct ??
    sellLadderConfig?.strength
  );
  const sellLadderStrengthPct = sellLadderStrengthPctRaw === null ? 100 : clamp(sellLadderStrengthPctRaw, 0, 500);
  const sellLadderMinFactorRaw = asNumber(
    rawRules?.sellLadderMinFactor ??
    sellLadderConfig?.minFactor
  );
  const sellLadderMinFactor = sellLadderMinFactorRaw === null ? 0.1 : clamp(sellLadderMinFactorRaw, 0.01, 1);
  const sellLadderMaxFactorRaw = asNumber(
    rawRules?.sellLadderMaxFactor ??
    sellLadderConfig?.maxFactor
  );
  const sellLadderMaxFactorFloor = Math.max(1, sellLadderMinFactor || 0.1);
  const sellLadderMaxFactor = Math.max(
    sellLadderMaxFactorFloor,
    sellLadderMaxFactorRaw === null ? 2 : clamp(sellLadderMaxFactorRaw, 1, 10)
  );

  return {
    sizingMode,
    allocationValue,
    reinvestmentPct,
    minQuoteSpend,
    maxQuoteSpend,
    minSellNotional,
    compoundingEnabled,
    compoundingMode,
    compoundingBaseQuote,
    compoundingPct,
    targetSpendPct,
    sellCompoundingEnabled,
    sellCompoundingMode,
    sellCompoundingBaseQuote,
    sellCompoundingPct,
    sellTargetSpendPct,
    sellLadderEnabled,
    sellLadderStrengthPct,
    sellLadderMinFactor,
    sellLadderMaxFactor,
    referencePriceSource: normalizeReferencePriceSource(rawRules?.referencePriceSource)
  };
}

async function resolveWorkspaceTradeBotRuntimeSizingConfig(workspaceId, integrationId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, workflowConfig: true }
  });
  if (!workspace) {
    throw new SizingConfigError('Workspace not found while resolving Trade Bot runtime sizing config.');
  }
  const workflowConfig = workspace.workflowConfig || {};
  const runtimeMatch = extractTradeBotRuntimeSizingForIntegration(workflowConfig, integrationId);
  if (runtimeMatch?.rules) {
    return {
      botId: runtimeMatch.botId,
      sizingSource: 'trade_bot_runtime',
      sizing: normalizeTradeBotRuntimeSizingConfig(runtimeMatch.rules)
    };
  }

  // Backward compatibility: fall back to workspace/base sizing when runtime link is absent.
  const legacyConfig = extractSizingConfigFromWorkflow(workflowConfig);
  const normalizedLegacy = normalizeBaseSizingConfig(legacyConfig || {});
  return {
    botId: null,
    sizingSource: 'workflow_legacy',
    sizing: normalizedLegacy
  };
}

export function adjustQuantityUpToMinNotional({
  qtyRounded,
  computedPrice,
  effectiveMinNotional = 0,
  stepSize = 0,
  normalizedSide = null,
  freeQuote = 0,
  freeBase = 0
}) {
  const qty = asNumber(qtyRounded) || 0;
  const price = asNumber(computedPrice) || 0;
  const minNotional = toFiniteOrZero(effectiveMinNotional);
  const step = toFiniteOrZero(stepSize);
  const side = String(normalizedSide || '').trim().toUpperCase();
  const availableQuote = asNumber(freeQuote) || 0;
  const availableBase = asNumber(freeBase) || 0;

  const currentNotional = qty * price;
  if (!qty || !price || !minNotional || currentNotional >= minNotional) {
    return {
      qtyRounded: qty,
      notional: currentNotional,
      adjusted: false
    };
  }

  const minQtyForNotional = minNotional / price;
  const qtyRoundedUp = step > 0 ? roundUpToStep(minQtyForNotional, step) : minQtyForNotional;
  const notionalRoundedUp = qtyRoundedUp * price;
  const buyCanAffordRoundedUp = side !== 'BUY' || notionalRoundedUp <= availableQuote + 1e-12;
  const sellCanFundRoundedUp = side !== 'SELL' || qtyRoundedUp <= availableBase + 1e-12;

  if (qtyRoundedUp > 0 && buyCanAffordRoundedUp && sellCanFundRoundedUp) {
    return {
      qtyRounded: qtyRoundedUp,
      notional: notionalRoundedUp,
      adjusted: true
    };
  }

  return {
    qtyRounded: qty,
    notional: currentNotional,
    adjusted: false
  };
}

export async function computeMexcBaseQuantityForSignal({ workspaceId, integrationId, symbol, side = null, client }) {
  // Resolve sizing before calling exchange APIs so config errors fail fast without network calls.
  const { botId, sizing, sizingSource } = await resolveWorkspaceTradeBotRuntimeSizingConfig(workspaceId, integrationId);
  const [account, ticker, filters, bookTicker] = await Promise.all([
    client.getAccount(),
    client.getTickerPrice(symbol),
    client.getSymbolFilters(symbol),
    typeof client.getBookTicker === 'function' ? client.getBookTicker(symbol).catch(() => null) : Promise.resolve(null)
  ]);

  const normalizedSymbol = String(symbol || '').toUpperCase();
  const quoteAsset = String(filters?.quoteAsset || quoteAssetFromSymbol(symbol) || 'USDC').toUpperCase();
  const baseAsset = String(filters?.baseAsset || baseAssetFromSymbol(symbol, quoteAsset) || '').toUpperCase() || null;
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const quoteBalance = balances.find((row) => String(row?.asset || '').toUpperCase() === quoteAsset);
  const baseBalance = baseAsset
    ? balances.find((row) => String(row?.asset || '').toUpperCase() === baseAsset)
    : null;
  const freeQuote = asNumber(quoteBalance?.free) || 0;
  const freeBase = asNumber(baseBalance?.free) || 0;
  const lastPrice = asNumber(ticker?.price);
  const markPrice = asNumber(bookTicker?.mark) || asNumber(bookTicker?.mid) || lastPrice;
  const midPrice = asNumber(bookTicker?.mid) || markPrice || lastPrice;
  const computedPrice =
    sizing.referencePriceSource === 'mark'
      ? markPrice
      : sizing.referencePriceSource === 'mid'
        ? midPrice
        : lastPrice || markPrice || midPrice;
  const stepSize = asNumber(filters?.stepSize) || 0;
  const minQty = asNumber(filters?.minQty) || 0;
  const minNotional = asNumber(filters?.minNotional) || 0;
  const normalizedSide = side ? String(side).trim().toUpperCase() : null;
  const stepSizeNum = toFiniteOrZero(stepSize);
  const minQtyNum = toFiniteOrZero(minQty);
  const minNotionalNum = toFiniteOrZero(minNotional);

  const sizingDebug = {
    symbol: normalizedSymbol || null,
    side: normalizedSide,
    botId: botId || null,
    sizingSource,
    freeBase,
    freeQuote,
    priceUsed: computedPrice,
    lastPrice,
    markPrice,
    midPrice,
    sizingMode: sizing.sizingMode,
    allocationValue: sizing.allocationValue,
    reinvestmentPct: sizing.reinvestmentPct,
    compoundingEnabled: sizing.compoundingEnabled,
    compoundingMode: sizing.compoundingMode,
    compoundingPct: sizing.compoundingPct,
    compoundingBaseQuote: sizing.compoundingBaseQuote,
    targetSpendPct: sizing.targetSpendPct,
    compoundingFactor: 1,
    compoundingProfitQuote: 0,
    sellCompoundingEnabled: sizing.sellCompoundingEnabled,
    sellCompoundingMode: sizing.sellCompoundingMode,
    sellCompoundingPct: sizing.sellCompoundingPct,
    sellCompoundingBaseQuote: sizing.sellCompoundingBaseQuote,
    sellTargetSpendPct: sizing.sellTargetSpendPct,
    sellCompoundingFactor: 1,
    sellCompoundingProfitQuote: 0,
    sellTargetSpendRatio: null,
    sellTargetSpendApplied: false,
    sellCompoundingApplied: false,
    sellLadderEnabled: sizing.sellLadderEnabled,
    sellLadderStrengthPct: sizing.sellLadderStrengthPct,
    sellLadderMinFactor: sizing.sellLadderMinFactor,
    sellLadderMaxFactor: sizing.sellLadderMaxFactor,
    sellLadderFactor: 1,
    sellLadderApplied: false,
    sellReferenceBuyPrice: null,
    sellMarketPrice: null,
    sellEdgeRatio: null,
    sellProfitSide: null,
    baseQuoteSpend: null,
    referencePriceSource: sizing.referencePriceSource,
    minQuoteSpend: sizing.minQuoteSpend,
    maxQuoteSpend: sizing.maxQuoteSpend,
    minSellNotional: sizing.minSellNotional,
    stepSize: stepSizeNum,
    minQty: minQtyNum,
    minNotional: minNotionalNum,
    qtyRaw: null,
    qtyAfterStepRounding: null,
    quoteSpendComputed: null,
    notionalAfterRounding: null,
    roundingApplied: null,
    effectiveMinNotional: null,
    minQtyExecutable: null,
    minNotionalExecutable: null,
    rejectedReason: null
  };

  if (!computedPrice || computedPrice <= 0) {
    throwSizingError('Cannot compute quantity without a valid market price.', sizingDebug, 'invalid_price');
  }

  if (sizingSource === 'workflow_legacy') {
    const legacyResult =
      normalizedSide === 'SELL'
        ? computeSellQuantityFromInputs({
            freeBase,
            sellMode: sizing.sellMode,
            sellFixedBaseQty: sizing.sellFixedBaseQty,
            sellPctOfFreeBase: sizing.sellPctOfFreeBase,
            price: computedPrice,
            stepSize: stepSizeNum,
            minNotional: minNotionalNum,
            minQty: minQtyNum,
            sizingDebugBase: sizingDebug
          })
        : computeBaseQuantityFromInputs({
            fixedBaseQty: sizing.fixedBaseQty,
            riskPctOfFreeQuote: sizing.riskPctOfFreeQuote,
            minQuoteSpend: sizing.minQuoteSpend,
            freeQuote,
            price: computedPrice,
            stepSize: stepSizeNum,
            minNotional: minNotionalNum,
            minQty: minQtyNum,
            sizingDebugBase: sizingDebug
          });

    const legacySizingDebug = {
      ...(legacyResult.sizingDebug || {}),
      sizingSource
    };

    return {
      qtyRaw: legacyResult.qtyRaw,
      qtyRounded: legacyResult.qtyRounded,
      notional: legacyResult.notional,
      quoteSpendComputed: legacyResult.quoteSpendComputed ?? legacyResult.notional,
      freeQuote,
      freeBase,
      computedPrice,
      quoteAsset,
      baseAsset,
      stepSize,
      minQty,
      minNotional,
      sizing,
      sizingSource,
      sizingDebug: legacySizingDebug
    };
  }

  let qtyRaw = 0;
  let quoteSpendComputed = null;

  if (normalizedSide === 'SELL') {
    if (!freeBase || freeBase <= 0) {
      sizingDebug.qtyRaw = 0;
      sizingDebug.qtyAfterStepRounding = 0;
      sizingDebug.quoteSpendComputed = 0;
      sizingDebug.notionalAfterRounding = 0;
      throwSizingError(
        'Cannot compute sell quantity because free base balance is zero.',
        sizingDebug,
        'insufficient_base_for_requested_qty'
      );
    }

    if (sizing.sizingMode === 'fixed_quote') {
      const targetQuote = Math.max(toFiniteOrZero(sizing.allocationValue), toFiniteOrZero(sizing.minSellNotional));
      quoteSpendComputed = clamp(targetQuote, toFiniteOrZero(sizing.minSellNotional), sizing.maxQuoteSpend);
      if (!quoteSpendComputed || quoteSpendComputed <= 0) {
        throwSizingError('Trade Bot sell quote target resolves to zero.', sizingDebug, 'invalid_quote_spend');
      }
      qtyRaw = quoteSpendComputed / computedPrice;
    } else {
      const pctOfBase = clamp(sizing.allocationValue, 0, 100);
      if (pctOfBase === null || pctOfBase <= 0) {
        throwSizingError('Trade Bot sell allocation percent resolves to zero.', sizingDebug, 'invalid_quote_spend');
      }
      qtyRaw = freeBase * (pctOfBase / 100);
      quoteSpendComputed = qtyRaw * computedPrice;
    }
    const baseSellQuoteSpend = quoteSpendComputed;
    sizingDebug.baseQuoteSpend = asNullableNumber(baseSellQuoteSpend);

    const referenceBuyPrice = await resolveSellLadderReferenceBuyPrice({
      workspaceId,
      integrationId,
      symbol: normalizedSymbol
    });
    const sellEdgeRatio =
      referenceBuyPrice && referenceBuyPrice > 0
        ? (computedPrice - referenceBuyPrice) / referenceBuyPrice
        : null;
    const sellProfitSide = sellEdgeRatio !== null && sellEdgeRatio > 0;
    sizingDebug.sellReferenceBuyPrice = asNullableNumber(referenceBuyPrice);
    sizingDebug.sellMarketPrice = asNullableNumber(computedPrice);
    sizingDebug.sellEdgeRatio = asNullableNumber(sellEdgeRatio);
    sizingDebug.sellProfitSide = sellProfitSide;

    if (sellProfitSide && sizing.sellCompoundingEnabled) {
      const sellQuoteCapacity = Math.max(0, freeBase * computedPrice);
      const compoundedSell = applyCompoundingToQuoteSpend({
        baseQuoteSpend: quoteSpendComputed,
        freeQuote: sellQuoteCapacity,
        compoundingEnabled: true,
        compoundingMode: sizing.sellCompoundingMode,
        compoundingBaseQuote: sizing.sellCompoundingBaseQuote,
        compoundingPct: sizing.sellCompoundingPct,
        targetSpendRatio: sizing.sellTargetSpendPct ? sizing.sellTargetSpendPct / 100 : null
      });
      const minSellFloor = toFiniteOrZero(sizing.minSellNotional);
      quoteSpendComputed = clamp(compoundedSell.quoteSpend, minSellFloor, sizing.maxQuoteSpend);
      if (!quoteSpendComputed || quoteSpendComputed <= 0) {
        throwSizingError('Trade Bot sell compounding resolves to zero.', sizingDebug, 'invalid_quote_spend');
      }
      qtyRaw = Math.min(freeBase, quoteSpendComputed / computedPrice);
      sizingDebug.sellCompoundingApplied = true;
      sizingDebug.sellCompoundingFactor = asNullableNumber(compoundedSell.compoundingFactor);
      sizingDebug.sellCompoundingProfitQuote = asNullableNumber(compoundedSell.compoundingProfitQuote);
      sizingDebug.sellCompoundingBaseQuote = asNullableNumber(compoundedSell.compoundingBaseQuote);
      sizingDebug.sellTargetSpendRatio = asNullableNumber(compoundedSell.targetSpendRatio);
      sizingDebug.sellTargetSpendApplied = compoundedSell.targetSpendApplied === true;
    } else if (sizing.sellLadderEnabled) {
      const sellLadder = applySellLadderToSellQuantity({
        qtyRaw,
        freeBase,
        marketSellPrice: computedPrice,
        referenceBuyPrice,
        sellLadderEnabled: sizing.sellLadderEnabled,
        sellLadderStrengthPct: sizing.sellLadderStrengthPct,
        sellLadderMinFactor: sizing.sellLadderMinFactor,
        sellLadderMaxFactor: sizing.sellLadderMaxFactor
      });
      qtyRaw = sellLadder.qtyRaw;
      quoteSpendComputed = qtyRaw * computedPrice;
      sizingDebug.sellLadderApplied = sellLadder.applied === true;
      sizingDebug.sellLadderFactor = asNullableNumber(sellLadder.factor);
      if (sellLadder.edgeRatio !== null && sellLadder.edgeRatio !== undefined) {
        sizingDebug.sellEdgeRatio = asNullableNumber(sellLadder.edgeRatio);
      }
    }
  } else {
    let quoteSpendRaw;
    if (sizing.sizingMode === 'fixed_quote') {
      quoteSpendRaw = sizing.allocationValue;
    } else {
      const pctSpend = freeQuote * (sizing.allocationValue / 100);
      const reinvestmentFactor = Math.max(0, Math.min(1, sizing.reinvestmentPct / 100));
      quoteSpendRaw = pctSpend * reinvestmentFactor;
    }
    const compounded = applyCompoundingToQuoteSpend({
      baseQuoteSpend: quoteSpendRaw,
      freeQuote,
      compoundingEnabled: sizing.compoundingEnabled,
      compoundingMode: sizing.compoundingMode,
      compoundingBaseQuote: sizing.compoundingBaseQuote,
      compoundingPct: sizing.compoundingPct,
      targetSpendRatio: sizing.targetSpendPct ? sizing.targetSpendPct / 100 : null
    });
    quoteSpendRaw = compounded.quoteSpend;
    sizingDebug.baseQuoteSpend = asNullableNumber(compounded.baseQuoteSpend);
    sizingDebug.compoundingFactor = asNullableNumber(compounded.compoundingFactor);
    sizingDebug.compoundingProfitQuote = asNullableNumber(compounded.compoundingProfitQuote);
    sizingDebug.compoundingBaseQuote = asNullableNumber(compounded.compoundingBaseQuote);
    sizingDebug.targetSpendRatio = asNullableNumber(compounded.targetSpendRatio);
    sizingDebug.targetSpendApplied = compounded.targetSpendApplied === true;

    const minQuoteSpendFloor = normalizedSide === 'BUY' ? sizing.minQuoteSpend : 0;
    quoteSpendComputed = clamp(quoteSpendRaw, minQuoteSpendFloor, sizing.maxQuoteSpend);
    if (!quoteSpendComputed || quoteSpendComputed <= 0) {
      throwSizingError('Trade Bot quote spend resolves to zero.', sizingDebug, 'invalid_quote_spend');
    }

    if (quoteSpendComputed > freeQuote + 1e-12) {
      throwSizingError(
        `Configured quote spend ${quoteSpendComputed} exceeds available quote balance ${freeQuote}.`,
        sizingDebug,
        'insufficient_quote_for_requested_qty'
      );
    }

    qtyRaw = quoteSpendComputed / computedPrice;
  }

  let qtyRounded = roundDownToStep(qtyRaw, stepSizeNum);
  let notional = qtyRounded * computedPrice;
  const effectiveMinNotional = resolveEffectiveMinNotional({
    normalizedSide,
    exchangeMinNotional: minNotionalNum,
    minQuoteSpend: sizing.minQuoteSpend,
    minSellNotional: sizing.minSellNotional
  });

  sizingDebug.qtyRaw = asNumber(qtyRaw);
  sizingDebug.effectiveMinNotional = effectiveMinNotional;

  if (!qtyRounded || qtyRounded <= 0) {
    throwSizingError(
      'Computed quantity is zero after applying step size rounding.',
      sizingDebug,
      'below_step_size'
    );
  }
  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    throwSizingError(
      `Quantity ${qtyRounded} is below exchange minQty ${minQtyNum}.`,
      sizingDebug,
      'below_min_qty'
    );
  }
  if (effectiveMinNotional > 0 && notional < effectiveMinNotional) {
    const adjusted = adjustQuantityUpToMinNotional({
      qtyRounded,
      computedPrice,
      effectiveMinNotional,
      stepSize: stepSizeNum,
      normalizedSide,
      freeQuote,
      freeBase
    });
    if (adjusted.adjusted) {
      qtyRounded = adjusted.qtyRounded;
      notional = adjusted.notional;
      sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_MIN_NOTIONAL');
    }
  }

  sizingDebug.quoteSpendComputed = asNullableNumber(notional);
  sizingDebug.qtyAfterStepRounding = asNumber(qtyRounded) || 0;
  sizingDebug.notionalAfterRounding = asNumber(notional) || 0;

  if (effectiveMinNotional > 0 && notional < effectiveMinNotional) {
    const shortfall = classifyMinNotionalShortfall({
      normalizedSide,
      effectiveMinNotional,
      computedPrice,
      stepSize: stepSizeNum,
      freeQuote,
      freeBase
    });
    const shortfallReason = shortfall?.reason || 'below_min_notional';
    sizingDebug.minQtyExecutable = asNullableNumber(shortfall?.minQtyExecutable);
    sizingDebug.minNotionalExecutable = asNullableNumber(shortfall?.minNotionalExecutable);
    if (shortfallReason === 'insufficient_quote_for_requested_qty') {
      throwSizingError(
        `Available quote balance ${freeQuote} cannot satisfy minimum executable notional ${shortfall?.minNotionalExecutable}.`,
        sizingDebug,
        shortfallReason
      );
    }
    if (shortfallReason === 'insufficient_base_for_requested_qty') {
      throwSizingError(
        `Available base balance ${freeBase} cannot satisfy minimum executable quantity ${shortfall?.minQtyExecutable}.`,
        sizingDebug,
        shortfallReason
      );
    }
    throwSizingError(
      `Order value ${notional} is below effective minNotional ${effectiveMinNotional}.`,
      sizingDebug,
      shortfallReason
    );
  }
  if (normalizedSide === 'SELL' && qtyRounded > freeBase + 1e-12) {
    throwSizingError(
      `Configured sell quantity ${qtyRounded} exceeds available base balance ${freeBase}.`,
      sizingDebug,
      'insufficient_base_for_requested_qty'
    );
  }

  return {
    qtyRaw,
    qtyRounded,
    notional,
    quoteSpendComputed: notional,
    freeQuote,
    freeBase,
    computedPrice,
    quoteAsset,
    baseAsset,
    stepSize,
    minQty,
    minNotional,
    sizing,
    sizingSource,
    sizingDebug
  };
}

function joinRoundingReason(current, reason) {
  if (!reason) return current || null;
  if (!current) return reason;
  if (String(current).split(',').includes(reason)) return current;
  return `${current},${reason}`;
}

export async function computeMexcBaseQuantityFromSignalPayload({
  symbol,
  side = null,
  client,
  requestedQty = null,
  requestedAmount = null
}) {
  const [account, ticker, filters] = await Promise.all([
    client.getAccount(),
    client.getTickerPrice(symbol),
    client.getSymbolFilters(symbol)
  ]);

  const normalizedSymbol = String(symbol || '').toUpperCase();
  const quoteAsset = String(filters?.quoteAsset || quoteAssetFromSymbol(symbol) || 'USDC').toUpperCase();
  const baseAsset = String(filters?.baseAsset || baseAssetFromSymbol(symbol, quoteAsset) || '').toUpperCase() || null;
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const quoteBalance = balances.find((row) => String(row?.asset || '').toUpperCase() === quoteAsset);
  const baseBalance = baseAsset
    ? balances.find((row) => String(row?.asset || '').toUpperCase() === baseAsset)
    : null;
  const freeQuote = asNumber(quoteBalance?.free) || 0;
  const freeBase = asNumber(baseBalance?.free) || 0;
  const computedPrice = asNumber(ticker?.price);
  const stepSize = asNumber(filters?.stepSize) || 0;
  const minQty = asNumber(filters?.minQty) || 0;
  const minNotional = asNumber(filters?.minNotional) || 0;
  const normalizedSide = side ? String(side).toUpperCase() : null;
  const safeRequestedQty = asNumber(requestedQty);
  const safeRequestedAmount = asNumber(requestedAmount);
  const stepSizeNum = toFiniteOrZero(stepSize);
  const minQtyNum = toFiniteOrZero(minQty);
  const minNotionalNum = toFiniteOrZero(minNotional);

  const sizingDebug = {
    symbol: normalizedSymbol || null,
    side: normalizedSide,
    freeBase,
    freeQuote,
    priceUsed: computedPrice,
    sizingMode: 'PINE_PAYLOAD',
    requestedQty: asNullableNumber(safeRequestedQty),
    requestedAmount: asNullableNumber(safeRequestedAmount),
    stepSize: stepSizeNum,
    minQty: minQtyNum,
    minNotional: minNotionalNum,
    qtyRaw: null,
    qtyAfterStepRounding: null,
    quoteSpendComputed: null,
    notionalAfterRounding: null,
    roundingApplied: null,
    balanceClampApplied: false,
    qtyBeforeBalanceClamp: null,
    quoteSpendBeforeBalanceClamp: null,
    rejectedReason: null
  };

  if (!computedPrice || computedPrice <= 0) {
    throwSizingError('Cannot compute quantity without a valid market price.', sizingDebug, 'invalid_price');
  }

  if ((!safeRequestedQty || safeRequestedQty <= 0) && (!safeRequestedAmount || safeRequestedAmount <= 0)) {
    throwSizingError('Signal payload must include qty/quantity or amount > 0.', sizingDebug, 'missing_signal_qty_amount');
  }

  let qtyRaw = safeRequestedQty && safeRequestedQty > 0
    ? safeRequestedQty
    : safeRequestedAmount / computedPrice;
  let quoteSpendComputed = safeRequestedAmount && safeRequestedAmount > 0
    ? safeRequestedAmount
    : qtyRaw * computedPrice;

  sizingDebug.qtyRaw = asNumber(qtyRaw);
  sizingDebug.quoteSpendComputed = asNullableNumber(quoteSpendComputed);

  let qtyRounded = stepSizeNum > 0 ? roundDownToStep(qtyRaw, stepSizeNum) : qtyRaw;
  if (stepSizeNum > 0 && Math.abs(qtyRaw - qtyRounded) > 1e-12) {
    sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'DOWN_TO_STEP');
  }

  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    const minQtyAdjusted = stepSizeNum > 0 ? roundUpToStep(minQtyNum, stepSizeNum) : minQtyNum;
    if (minQtyAdjusted > qtyRounded + 1e-12) {
      qtyRounded = minQtyAdjusted;
      sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_MIN_QTY');
    }
  }

  let notional = qtyRounded * computedPrice;
  if (minNotionalNum > 0 && notional < minNotionalNum) {
    const minQtyForNotional = minNotionalNum / computedPrice;
    const minNotionalAdjusted = stepSizeNum > 0 ? roundUpToStep(minQtyForNotional, stepSizeNum) : minQtyForNotional;
    if (minNotionalAdjusted > qtyRounded + 1e-12) {
      qtyRounded = minNotionalAdjusted;
      notional = qtyRounded * computedPrice;
      sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_MIN_NOTIONAL');
    }
  }

  const qtyBeforeBalanceClamp = qtyRounded;
  const quoteSpendBeforeBalanceClamp = qtyRounded * computedPrice;
  let balanceClampReason = null;
  if (normalizedSide === 'BUY') {
    const maxBuyQtyRaw = freeQuote > 0 ? freeQuote / computedPrice : 0;
    const maxBuyQty = stepSizeNum > 0 ? roundDownToStep(maxBuyQtyRaw, stepSizeNum) : maxBuyQtyRaw;
    if (qtyRounded > maxBuyQty + 1e-12) {
      qtyRounded = maxBuyQty;
      balanceClampReason = 'DOWN_TO_FREE_QUOTE';
    }
  } else if (normalizedSide === 'SELL') {
    const maxSellQtyRaw = freeBase > 0 ? freeBase : 0;
    const maxSellQty = stepSizeNum > 0 ? roundDownToStep(maxSellQtyRaw, stepSizeNum) : maxSellQtyRaw;
    if (qtyRounded > maxSellQty + 1e-12) {
      qtyRounded = maxSellQty;
      balanceClampReason = 'DOWN_TO_FREE_BASE';
    }
  }

  if (balanceClampReason) {
    sizingDebug.balanceClampApplied = true;
    sizingDebug.qtyBeforeBalanceClamp = asNullableNumber(qtyBeforeBalanceClamp);
    sizingDebug.quoteSpendBeforeBalanceClamp = asNullableNumber(quoteSpendBeforeBalanceClamp);
    sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, balanceClampReason);
  }

  notional = qtyRounded * computedPrice;
  quoteSpendComputed = notional;
  sizingDebug.qtyAfterStepRounding = asNumber(qtyRounded) || 0;
  sizingDebug.notionalAfterRounding = asNumber(notional) || 0;
  sizingDebug.quoteSpendComputed = asNullableNumber(quoteSpendComputed);

  if (!qtyRounded || qtyRounded <= 0) {
    const zeroReason = normalizedSide === 'BUY'
      ? (balanceClampReason === 'DOWN_TO_FREE_QUOTE' || freeQuote <= 0
        ? 'insufficient_quote_for_requested_qty'
        : 'below_step_size')
      : normalizedSide === 'SELL'
        ? (balanceClampReason === 'DOWN_TO_FREE_BASE' || freeBase <= 0
          ? 'insufficient_base_for_requested_qty'
          : 'below_step_size')
        : 'below_step_size';
    throwSizingError('Computed quantity is zero after signal sizing normalization.', sizingDebug, zeroReason);
  }
  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    const minQtyReason = normalizedSide === 'BUY' && freeQuote + 1e-12 < (minQtyNum * computedPrice)
      ? 'insufficient_quote_for_requested_qty'
      : normalizedSide === 'SELL' && freeBase + 1e-12 < minQtyNum
        ? 'insufficient_base_for_requested_qty'
        : 'below_min_qty';
    throwSizingError(
      `Quantity ${qtyRounded} is below exchange minQty ${minQtyNum}.`,
      sizingDebug,
      minQtyReason
    );
  }
  if (minNotionalNum > 0 && notional < minNotionalNum) {
    const minNotionalReason = normalizedSide === 'BUY' && freeQuote + 1e-12 < minNotionalNum
      ? 'insufficient_quote_for_requested_qty'
      : normalizedSide === 'SELL' && (freeBase * computedPrice) + 1e-12 < minNotionalNum
        ? 'insufficient_base_for_requested_qty'
        : 'below_min_notional';
    throwSizingError(
      `Order value ${notional} is below exchange minNotional ${minNotionalNum}.`,
      sizingDebug,
      minNotionalReason
    );
  }

  if (normalizedSide === 'BUY' && quoteSpendComputed > freeQuote + 1e-12) {
    throwSizingError(
      `Signal requires ~${quoteSpendComputed} ${quoteAsset}, but available quote balance is ${freeQuote}.`,
      sizingDebug,
      'insufficient_quote_for_requested_qty'
    );
  }
  if (normalizedSide === 'SELL' && qtyRounded > freeBase + 1e-12) {
    throwSizingError(
      `Signal requests ${qtyRounded} ${baseAsset || 'base'}, but available base balance is ${freeBase}.`,
      sizingDebug,
      'insufficient_base_for_requested_qty'
    );
  }

  return {
    qtyRaw,
    qtyRounded,
    notional,
    quoteSpendComputed,
    freeQuote,
    freeBase,
    computedPrice,
    quoteAsset,
    baseAsset,
    stepSize,
    minQty,
    minNotional,
    sizing: {
      sizingMode: 'PINE_PAYLOAD'
    },
    sizingDebug
  };
}
