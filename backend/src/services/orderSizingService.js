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

function firstObject(candidates = []) {
  return candidates.find((item) => item && typeof item === 'object') || null;
}

function quoteAssetFromSymbol(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  if (normalized.endsWith('USDC')) return 'USDC';
  if (normalized.endsWith('USDT')) return 'USDT';
  return null;
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
  minQty = 0
}) {
  const safePrice = asNumber(price);
  const safeFreeQuote = asNumber(freeQuote);
  if (!safePrice || safePrice <= 0) {
    throw new SizingConfigError('Cannot compute quantity without a valid market price.');
  }

  let qtyRaw = null;
  if (fixedBaseQty !== null && fixedBaseQty !== undefined) {
    const fixed = asNumber(fixedBaseQty);
    if (!fixed || fixed <= 0) {
      throw new SizingConfigError('fixedBaseQty must be greater than 0.');
    }
    qtyRaw = fixed;
  } else {
    if (!safeFreeQuote || safeFreeQuote <= 0) {
      throw new SizingConfigError('Cannot compute quantity because free quote balance is zero.');
    }
    const pct = asNumber(riskPctOfFreeQuote);
    if (!pct || pct <= 0) {
      throw new SizingConfigError('riskPctOfFreeQuote must be greater than 0.');
    }
    const quoteSpend = safeFreeQuote * (pct / 100);
    qtyRaw = quoteSpend / safePrice;
  }

  const qtyRounded = roundDownToStep(qtyRaw, stepSize);
  if (!qtyRounded || qtyRounded <= 0) {
    throw new SizingConfigError('Computed quantity is zero after applying step size rounding.');
  }

  const minQtyNum = asNumber(minQty) || 0;
  if (minQtyNum > 0 && qtyRounded < minQtyNum) {
    throw new SizingConfigError(`Quantity ${qtyRounded} is below exchange minQty ${minQtyNum}.`);
  }

  const minNotionalNum = asNumber(minNotional) || 0;
  const notional = qtyRounded * safePrice;
  if (minNotionalNum > 0 && notional < minNotionalNum) {
    throw new SizingConfigError(`Order value ${notional} is below exchange minNotional ${minNotionalNum}.`);
  }

  return {
    qtyRaw,
    qtyRounded,
    notional
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

export async function computeMexcBaseQuantityForSignal({ workspaceId, symbol, client }) {
  const sizing = await resolveWorkspaceSizingConfig(workspaceId);
  const [account, ticker, filters] = await Promise.all([
    client.getAccount(),
    client.getTickerPrice(symbol),
    client.getSymbolFilters(symbol)
  ]);

  const quoteAsset = String(filters?.quoteAsset || quoteAssetFromSymbol(symbol) || 'USDC').toUpperCase();
  const balances = Array.isArray(account?.balances) ? account.balances : [];
  const quoteBalance = balances.find((row) => String(row?.asset || '').toUpperCase() === quoteAsset);
  const freeQuote = asNumber(quoteBalance?.free) || 0;
  const computedPrice = asNumber(ticker?.price);

  const quantity = computeBaseQuantityFromInputs({
    fixedBaseQty: sizing.fixedBaseQty,
    riskPctOfFreeQuote: sizing.riskPctOfFreeQuote,
    freeQuote,
    price: computedPrice,
    stepSize: filters?.stepSize,
    minNotional: filters?.minNotional,
    minQty: filters?.minQty
  });

  return {
    ...quantity,
    freeQuote,
    computedPrice,
    quoteAsset,
    baseAsset: filters?.baseAsset || null,
    stepSize: asNumber(filters?.stepSize) || 0,
    minQty: asNumber(filters?.minQty) || 0,
    minNotional: asNumber(filters?.minNotional) || 0,
    sizing
  };
}
