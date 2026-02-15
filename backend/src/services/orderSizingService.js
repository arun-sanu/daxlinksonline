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
  const scaledValue = valueNum / stepNum;
  const floored = Math.floor(scaledValue + 1e-12) * stepNum;
  return Number(floored.toFixed(Math.max(0, decimals)));
}

export function roundUpToStep(value, stepSize) {
  const valueNum = asNumber(value);
  if (!valueNum || valueNum <= 0) return 0;
  const stepNum = asNumber(stepSize);
  if (!stepNum || stepNum <= 0) return valueNum;
  const decimals = stepDecimals(stepNum);
  const scaledValue = valueNum / stepNum;
  const ceiled = Math.ceil(scaledValue - 1e-12) * stepNum;
  return Number(ceiled.toFixed(Math.max(0, decimals)));
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

export function applyCompoundingToQuoteSpend({
  baseQuoteSpend,
  freeQuote,
  compoundingEnabled = false,
  compoundingMode = 'full_balance',
  compoundingBaseQuote = null,
  compoundingPct = 100
}) {
  const baseSpend = asNumber(baseQuoteSpend);
  const freeQuoteNum = asNumber(freeQuote) || 0;
  const pct = clamp(compoundingPct, 0, 300);
  const strength = pct === null ? 1 : pct / 100;

  if (!baseSpend || baseSpend <= 0) {
    return {
      quoteSpend: 0,
      baseQuoteSpend: 0,
      compoundingFactor: 1,
      compoundingProfitQuote: 0,
      compoundingBaseQuote: asNumber(compoundingBaseQuote) || 0
    };
  }

  const inferredBaseQuote = compoundingMode === 'full_balance'
    ? (freeQuoteNum > 0 ? freeQuoteNum : baseSpend)
    : baseSpend;
  const baseQuote = toFiniteOrZero(compoundingBaseQuote) || inferredBaseQuote;
  const profitQuote = Math.max(0, freeQuoteNum - baseQuote);

  if (!compoundingEnabled || strength <= 0 || baseQuote <= 0) {
    return {
      quoteSpend: baseSpend,
      baseQuoteSpend: baseSpend,
      compoundingFactor: 1,
      compoundingProfitQuote: profitQuote,
      compoundingBaseQuote: baseQuote
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
    compoundingBaseQuote: baseQuote
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
  const compoundingEnabled = rawRules?.compoundingEnabled === true;
  const compoundingMode = normalizeCompoundingMode(rawRules?.compoundingMode, sizingMode);
  const compoundingBaseQuoteRaw = asNumber(rawRules?.compoundingBaseQuote);
  const compoundingBaseQuote = compoundingBaseQuoteRaw !== null && compoundingBaseQuoteRaw > 0 ? compoundingBaseQuoteRaw : null;
  const compoundingPctRaw = asNumber(rawRules?.compoundingPct);
  const compoundingPct = compoundingPctRaw === null ? 100 : clamp(compoundingPctRaw, 0, 300);

  return {
    sizingMode,
    allocationValue,
    reinvestmentPct,
    minQuoteSpend,
    maxQuoteSpend,
    compoundingEnabled,
    compoundingMode,
    compoundingBaseQuote,
    compoundingPct,
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
  const runtimeMatch = extractTradeBotRuntimeSizingForIntegration(workspace.workflowConfig || {}, integrationId);
  if (!runtimeMatch || !runtimeMatch.rules) {
    throw new SizingConfigError(
      'No Trade Bot runtime sizing config linked to this integration. Configure sizing in Trade Bots.'
    );
  }
  return {
    botId: runtimeMatch.botId,
    sizing: normalizeTradeBotRuntimeSizingConfig(runtimeMatch.rules)
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
  const [{ botId, sizing }, account, ticker, filters, bookTicker] = await Promise.all([
    resolveWorkspaceTradeBotRuntimeSizingConfig(workspaceId, integrationId),
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
    compoundingFactor: 1,
    compoundingProfitQuote: 0,
    baseQuoteSpend: null,
    referencePriceSource: sizing.referencePriceSource,
    minQuoteSpend: sizing.minQuoteSpend,
    maxQuoteSpend: sizing.maxQuoteSpend,
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
    compoundingPct: sizing.compoundingPct
  });
  quoteSpendRaw = compounded.quoteSpend;
  sizingDebug.baseQuoteSpend = asNullableNumber(compounded.baseQuoteSpend);
  sizingDebug.compoundingFactor = asNullableNumber(compounded.compoundingFactor);
  sizingDebug.compoundingProfitQuote = asNullableNumber(compounded.compoundingProfitQuote);
  sizingDebug.compoundingBaseQuote = asNullableNumber(compounded.compoundingBaseQuote);

  const quoteSpendComputed = clamp(quoteSpendRaw, sizing.minQuoteSpend, sizing.maxQuoteSpend);
  if (!quoteSpendComputed || quoteSpendComputed <= 0) {
    throwSizingError('Trade Bot quote spend resolves to zero.', sizingDebug, 'invalid_quote_spend');
  }

  if (normalizedSide !== 'SELL' && quoteSpendComputed > freeQuote + 1e-12) {
    throwSizingError(
      `Configured quote spend ${quoteSpendComputed} exceeds available quote balance ${freeQuote}.`,
      sizingDebug,
      'insufficient_quote_for_requested_qty'
    );
  }

  const qtyRaw = quoteSpendComputed / computedPrice;
  let qtyRounded = roundDownToStep(qtyRaw, stepSizeNum);
  let notional = qtyRounded * computedPrice;
  const effectiveMinNotional = Math.max(minNotionalNum, sizing.minQuoteSpend || 0);

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

  let qtyRounded = qtyRaw;
  const stepDown = roundDownToStep(qtyRaw, stepSizeNum);
  const isStepAligned = !stepSizeNum || Math.abs(qtyRaw - stepDown) <= 1e-12;
  if (!isStepAligned) {
    qtyRounded = roundUpToStep(qtyRaw, stepSizeNum);
    sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_STEP');
  }

  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    qtyRounded = stepSizeNum ? roundUpToStep(minQtyNum, stepSizeNum) : minQtyNum;
    sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_MIN_QTY');
  }

  let notional = qtyRounded * computedPrice;
  if (minNotionalNum > 0 && notional < minNotionalNum) {
    const minQtyForNotional = minNotionalNum / computedPrice;
    qtyRounded = stepSizeNum ? roundUpToStep(minQtyForNotional, stepSizeNum) : minQtyForNotional;
    notional = qtyRounded * computedPrice;
    sizingDebug.roundingApplied = joinRoundingReason(sizingDebug.roundingApplied, 'UP_TO_MIN_NOTIONAL');
  }

  sizingDebug.qtyAfterStepRounding = asNumber(qtyRounded) || 0;
  sizingDebug.notionalAfterRounding = asNumber(notional) || 0;
  quoteSpendComputed = qtyRounded * computedPrice;
  sizingDebug.quoteSpendComputed = asNullableNumber(quoteSpendComputed);

  if (!qtyRounded || qtyRounded <= 0) {
    throwSizingError('Computed quantity is zero after signal sizing normalization.', sizingDebug, 'below_step_size');
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
