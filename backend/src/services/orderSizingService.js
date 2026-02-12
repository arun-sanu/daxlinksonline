import { prisma } from '../utils/prisma.js';

export class SizingConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SizingConfigError';
    this.status = 422;
  }
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

export function roundDownToStep(value, stepSize) {
  const valueNum = asNumber(value);
  if (!valueNum || valueNum <= 0) return 0;
  const stepNum = asNumber(stepSize);
  if (!stepNum || stepNum <= 0) return valueNum;
  const stepString = String(stepNum);
  const decimals = stepString.includes('.') ? stepString.split('.')[1].replace(/0+$/, '').length : 0;
  const scaledValue = valueNum / stepNum;
  const floored = Math.floor(scaledValue + 1e-12) * stepNum;
  return Number(floored.toFixed(Math.max(0, decimals)));
}

export function normalizeBaseSizingConfig(rawConfig = {}, env = process.env) {
  const baseRule = rawConfig?.baseQtyRule && typeof rawConfig.baseQtyRule === 'object' ? rawConfig.baseQtyRule : rawConfig;
  const mode = String(rawConfig?.sizingMode || rawConfig?.mode || env.TV_SIZING_MODE || '').trim().toUpperCase();
  if (mode && mode !== 'BASE') {
    throw new SizingConfigError(`Unsupported sizingMode "${mode}". Only BASE mode is supported.`);
  }
  const fixedBaseQty = asNumber(baseRule?.fixedBaseQty ?? env.TV_FIXED_BASE_QTY);
  const riskPctOfFreeQuote = asNumber(baseRule?.riskPctOfFreeQuote ?? env.TV_RISK_PCT_FREE_QUOTE);

  const hasFixed = fixedBaseQty !== null && fixedBaseQty > 0;
  const hasRiskPct = riskPctOfFreeQuote !== null && riskPctOfFreeQuote > 0;
  if (!hasFixed && !hasRiskPct) {
    throw new SizingConfigError(
      'Missing sizing configuration. Configure fixedBaseQty or riskPctOfFreeQuote (DB workflow config or env).'
    );
  }

  return {
    sizingMode: 'BASE',
    fixedBaseQty: hasFixed ? fixedBaseQty : null,
    riskPctOfFreeQuote: hasRiskPct ? riskPctOfFreeQuote : null
  };
}

export function computeBaseQuantityFromInputs({
  fixedBaseQty = null,
  riskPctOfFreeQuote = null,
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

export async function computeMexcBaseQuantityForSignal({ workspaceId, symbol, side = null, client }) {
  const sizing = await resolveWorkspaceSizingConfig(workspaceId);
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

  const sizingDebugBase = {
    symbol: normalizedSymbol || null,
    side: normalizedSide,
    freeBase,
    freeQuote,
    priceUsed: computedPrice,
    sizingMode: sizing.sizingMode,
    fixedBaseQty: sizing.fixedBaseQty,
    riskPctOfFreeQuote: sizing.riskPctOfFreeQuote,
    stepSize,
    minQty,
    minNotional
  };

  let quantity;
  try {
    quantity = computeBaseQuantityFromInputs({
      fixedBaseQty: sizing.fixedBaseQty,
      riskPctOfFreeQuote: sizing.riskPctOfFreeQuote,
      freeQuote,
      price: computedPrice,
      stepSize,
      minNotional,
      minQty,
      sizingDebugBase
    });
  } catch (error) {
    if (error instanceof SizingConfigError && !error.sizingDebug) {
      error.sizingDebug = {
        ...sizingDebugBase,
        qtyRaw: null,
        quoteSpendComputed: null,
        qtyAfterStepRounding: null,
        notionalAfterRounding: null,
        rejectedReason: 'sizing_error'
      };
    }
    throw error;
  }

  return {
    ...quantity,
    freeQuote,
    freeBase,
    computedPrice,
    quoteAsset,
    baseAsset,
    stepSize,
    minQty,
    minNotional,
    sizing,
    sizingDebug: quantity.sizingDebug
  };
}
