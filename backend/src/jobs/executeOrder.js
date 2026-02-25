import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import { createMexcSpotClient } from '../services/mexcSpotClient.js';
import {
  SizingConfigError,
  computeMexcBaseQuantityForSignal,
  computeMexcBaseQuantityFromSignalPayload
} from '../services/orderSizingService.js';
import { EXECUTION_AUDIT_STATUS, updateExecutionAudit } from '../services/executionAuditService.js';
import { recordTradeTransaction } from '../services/tradeTransactionsService.js';

const isDryRun = process.env.WORKFLOW_EXECUTION_MODE === 'dryrun';
const DEBUG_TV_WEBHOOK = String(process.env.DEBUG_TV_WEBHOOK || 'false').toLowerCase() === 'true';
const ARN_LIMIT_ONLY_INVESTMENT_PCT_DEFAULT = 48.98;
const ARN_ORIGINAL_BOT_NAME_SLUGS = new Set([
  'arn-s-shcs-orginal',
  'arn-s-shcs-original'
]);
const ARN_LIMIT_ONLY_BOT_NAME_SLUGS = new Set([
  'arn-s-shcs-limit-only',
  'arn-s-shcs-limitonly',
  'arn-bot-service-limit-only'
]);

function debugExecution(stage, data = {}) {
  if (!DEBUG_TV_WEBHOOK) return;
  try {
    console.log('[tv-webhook-debug]', JSON.stringify({ stage, ...data }));
  } catch {
    console.log('[tv-webhook-debug]', stage);
  }
}

function logLedgerWriteError(error, context = {}) {
  const message = error?.message || String(error || 'unknown ledger write error');
  try {
    console.error(
      '[trade-ledger-write-failed]',
      JSON.stringify({
        message,
        ...context
      })
    );
  } catch {
    console.error('[trade-ledger-write-failed]', message);
  }
  debugExecution('ledger_write_failed', {
    message,
    ...context
  });
}

function toBuffer(value) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return Buffer.from(value);
}

function decryptRequired(blob, label) {
  if (!blob || (blob.length !== undefined && blob.length === 0)) {
    throw new Error(`${label} is missing`);
  }
  const secret = decrypt(toBuffer(blob));
  const trimmed = String(secret || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is empty after trimming`);
  }
  return trimmed;
}

function decryptOptional(blob) {
  if (!blob || (blob.length !== undefined && blob.length === 0)) return undefined;
  const secret = decrypt(toBuffer(blob));
  const trimmed = String(secret || '').trim();
  return trimmed || undefined;
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';
  return null;
}

function normalizeOrderType(value, fallback = 'MARKET') {
  const type = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!type) return fallback;
  if (type === 'market') return 'MARKET';
  if (type === 'limit') return 'LIMIT';
  if (type === 'limit_maker' || type === 'post_only' || type === 'postonly' || type === 'maker') return 'LIMIT_MAKER';
  return type.toUpperCase();
}

function isLimitOrderType(value) {
  return value === 'LIMIT' || value === 'LIMIT_MAKER';
}

function parseNumeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampPercentage(value, fallback = ARN_LIMIT_ONLY_INVESTMENT_PCT_DEFAULT) {
  const parsed = parseNumeric(value);
  const pct = parsed !== null ? parsed : fallback;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

function inferQuoteAssetFromSymbol(symbol) {
  const normalized = String(symbol || '')
    .trim()
    .toUpperCase();
  if (!normalized) return null;
  const knownQuotes = ['USDC', 'USDT', 'USD', 'BTC', 'ETH', 'INR', 'EUR'];
  for (const quote of knownQuotes) {
    if (normalized.endsWith(quote) && normalized.length > quote.length) return quote;
  }
  return null;
}

function inferBaseAssetFromSymbol(symbol, quoteAsset) {
  const normalized = String(symbol || '')
    .trim()
    .toUpperCase();
  const quote = String(quoteAsset || '')
    .trim()
    .toUpperCase();
  if (!normalized || !quote || !normalized.endsWith(quote)) return null;
  const base = normalized.slice(0, -quote.length).trim();
  return base || null;
}

function extractFreeBalance(accountPayload, asset) {
  const wantedAsset = String(asset || '')
    .trim()
    .toUpperCase();
  if (!wantedAsset) return 0;
  const balances = Array.isArray(accountPayload?.balances) ? accountPayload.balances : [];
  const row = balances.find((entry) => String(entry?.asset || '').toUpperCase() === wantedAsset);
  const free = parseNumeric(row?.free);
  return free && free > 0 ? free : 0;
}

function normalizeTextSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isArnOriginalBotName(value = '') {
  const slug = normalizeTextSlug(value);
  if (!slug) return false;
  if (ARN_ORIGINAL_BOT_NAME_SLUGS.has(slug)) return true;
  return slug.includes('arn') && slug.includes('shcs') && (slug.includes('orginal') || slug.includes('original'));
}

function isArnPineStrategy(value = '') {
  return String(value || '').trim().toUpperCase() === 'ARN_PINE_FAITHFUL';
}

function isArnLimitOnlyStrategy(value = '') {
  return String(value || '').trim().toUpperCase() === 'ARN_LIMIT_ONLY';
}

function isArnLimitOnlyBotName(value = '') {
  const slug = normalizeTextSlug(value);
  if (!slug) return false;
  if (ARN_LIMIT_ONLY_BOT_NAME_SLUGS.has(slug)) return true;
  return slug.includes('arn') && slug.includes('shcs') && slug.includes('limit');
}

function resolveSignalOrderType(signal) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const mappedOrder =
    rawPayload?.mappedOrder && typeof rawPayload.mappedOrder === 'object'
      ? rawPayload.mappedOrder
      : payload?.mappedOrder && typeof payload.mappedOrder === 'object'
        ? payload.mappedOrder
        : {};
  const orderTypeCandidates = [
    rawPayload?.orderType,
    rawPayload?.order_type,
    payload?.orderType,
    payload?.order_type,
    mappedOrder?.orderType,
    mappedOrder?.order_type,
    rawPayload?.type,
    payload?.type,
    signal?.type
  ];
  for (const candidate of orderTypeCandidates) {
    const normalized = normalizeOrderType(candidate, null);
    if (normalized) return normalized;
  }
  return 'MARKET';
}

function hasLimitOrderHints(signal) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];
  const keys = ['limitPrice', 'limit_price', 'limitStyle', 'limit_style', 'slippageBps', 'slippage_bps'];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (source[key] !== null && source[key] !== undefined && source[key] !== '') return true;
    }
  }
  return false;
}

function hasArnLimitOnlySignalHints(signal) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];
  const hasKey = (keys = []) =>
    sources.some((source) => keys.some((key) => Object.prototype.hasOwnProperty.call(source || {}, key)));
  return (
    hasKey(['limitStyle', 'limit_style']) &&
    hasKey(['slippageBps', 'slippage_bps']) &&
    hasKey(['quoteQty', 'quote_qty', 'tpPercent', 'tp_percent', 'slAtrMult', 'sl_atr_mult'])
  );
}

function pickFirstPositiveNumericValue(sources = [], keys = []) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const value = parseNumeric(source[key]);
      if (value !== null && value > 0) return value;
    }
  }
  return null;
}

function resolveSignalLimitPrice(signal, side, fallbackPrice = null) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const mappedOrder =
    rawPayload?.mappedOrder && typeof rawPayload.mappedOrder === 'object'
      ? rawPayload.mappedOrder
      : payload?.mappedOrder && typeof payload.mappedOrder === 'object'
        ? payload.mappedOrder
        : {};
  const sources = [rawPayload, payload, mappedOrder];

  const directPrice = pickFirstPositiveNumericValue(sources, [
    'limitPrice',
    'limit_price',
    'price',
    'entryPrice',
    'entry_price'
  ]);
  if (directPrice !== null) return directPrice;

  const referencePrice =
    pickFirstPositiveNumericValue(sources, ['close', 'markPrice', 'marketPrice']) ||
    parseNumeric(signal?.price) ||
    parseNumeric(fallbackPrice);
  if (!referencePrice || referencePrice <= 0) return null;

  const slippageBps =
    pickFirstPositiveNumericValue(sources, ['slippageBps', 'slippage_bps']) ||
    0;
  const slipMultiplier = Math.max(0, slippageBps) / 10000;
  if (String(side || '').toUpperCase() === 'BUY') {
    return referencePrice * (1 - slipMultiplier);
  }
  if (String(side || '').toUpperCase() === 'SELL') {
    return referencePrice * (1 + slipMultiplier);
  }
  return referencePrice;
}

async function resolveArnLimitOnlyBalanceSizing({ client, symbol, investmentPct }) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  const clampedPct = clampPercentage(investmentPct, ARN_LIMIT_ONLY_INVESTMENT_PCT_DEFAULT);
  const [account, ticker, filters] = await Promise.all([
    client.getAccount(),
    client.getTickerPrice(normalizedSymbol),
    client.getSymbolFilters(normalizedSymbol)
  ]);

  const quoteAsset = String(
    filters?.quoteAsset || inferQuoteAssetFromSymbol(normalizedSymbol) || 'USDC'
  ).toUpperCase();
  const baseAsset = String(
    filters?.baseAsset || inferBaseAssetFromSymbol(normalizedSymbol, quoteAsset) || ''
  ).toUpperCase() || null;
  const price = parseNumeric(ticker?.price);
  if (!price || price <= 0) {
    throw new Error('Cannot compute ARN limit-only size: invalid ticker price');
  }

  const freeQuote = extractFreeBalance(account, quoteAsset);
  const freeBase = baseAsset ? extractFreeBalance(account, baseAsset) : 0;
  const equityQuote = freeQuote + (freeBase * price);
  const requestedAmount = equityQuote * (clampedPct / 100);

  return {
    requestedAmount,
    equityQuote,
    investmentPct: clampedPct,
    freeQuote,
    freeBase,
    quoteAsset,
    baseAsset,
    price
  };
}

function extractSignalPayloadSizingRequest(signal) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];

  const pickFirstNumeric = (keys = []) => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = parseNumeric(source[key]);
        if (value !== null && value > 0) return value;
      }
    }
    return null;
  };

  const requestedQty = pickFirstNumeric(['qty', 'quantity', 'baseQty', 'baseQuantity', 'size']);
  const requestedAmount =
    pickFirstNumeric(['amount', 'quoteAmount', 'quoteQty', 'notional']) ||
    (() => {
      const amount = parseNumeric(signal?.amount);
      return amount !== null && amount > 0 ? amount : null;
    })();

  return { requestedQty, requestedAmount };
}

async function resolveRuntimeTradeBotForIntegration(workspaceId, integrationId) {
  const normalizedWorkspaceId = String(workspaceId || '').trim();
  const normalizedIntegrationId = String(integrationId || '').trim();
  if (!normalizedWorkspaceId || !normalizedIntegrationId) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      runtimeOrderType: null,
      runtimeInvestmentPct: null,
      arnOriginal: false,
      arnLimitOnly: false
    };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: normalizedWorkspaceId },
    select: { workflowConfig: true }
  });
  const runtimeConfigs = workspace?.workflowConfig?.tradeBots?.runtimeConfigs;
  if (!runtimeConfigs || typeof runtimeConfigs !== 'object' || Array.isArray(runtimeConfigs)) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      runtimeOrderType: null,
      runtimeInvestmentPct: null,
      arnOriginal: false,
      arnLimitOnly: false
    };
  }

  let matchedBotId = null;
  let matchedStrategy = null;
  let matchedOrderType = null;
  let matchedInvestmentPct = null;
  for (const [botId, entry] of Object.entries(runtimeConfigs)) {
    if (!entry || typeof entry !== 'object') continue;
    const linkedIntegrationId = String(entry?.links?.integrationId || '').trim();
    if (!linkedIntegrationId || linkedIntegrationId !== normalizedIntegrationId) continue;
    const rules = entry?.rules && typeof entry.rules === 'object' ? entry.rules : {};
    const codeParameters = rules?.codeParameters && typeof rules.codeParameters === 'object' ? rules.codeParameters : {};
    matchedBotId = botId;
    matchedStrategy = rules?.strategy || null;
    matchedOrderType =
      rules?.orderType ||
      rules?.order_type ||
      codeParameters?.orderType ||
      codeParameters?.order_type ||
      null;
    matchedInvestmentPct =
      parseNumeric(
        rules?.investmentPercentage ||
        rules?.investment_percentage ||
        codeParameters?.investmentPercentage ||
        codeParameters?.investment_percentage
      );
    break;
  }

  if (!matchedBotId) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      runtimeOrderType: null,
      runtimeInvestmentPct: null,
      arnOriginal: false,
      arnLimitOnly: false
    };
  }

  const bot = await prisma.bot.findUnique({
    where: { id: matchedBotId },
    select: { id: true, name: true }
  });
  const botName = bot?.name || null;
  const arnOriginal = isArnPineStrategy(matchedStrategy) || isArnOriginalBotName(botName);
  const arnLimitOnly = isArnLimitOnlyStrategy(matchedStrategy) || isArnLimitOnlyBotName(botName);

  return {
    botId: matchedBotId,
    botName,
    strategy: matchedStrategy,
    runtimeOrderType: normalizeOrderType(matchedOrderType, null),
    runtimeInvestmentPct: matchedInvestmentPct,
    arnOriginal,
    arnLimitOnly
  };
}

function hasSignalPayloadSizingHint(signal) {
  const keys = ['qty', 'quantity', 'baseQty', 'baseQuantity', 'size', 'amount', 'quoteAmount', 'quoteQty', 'notional'];
  const keySet = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key).toLowerCase()));
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];

  for (const obj of sources) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of Object.keys(obj)) {
      if (!keySet.has(String(key).toLowerCase())) continue;
      return true;
    }
  }

  return false;
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getAlertId(signal) {
  return signal?.payload?.raw?.alertId || signal?.payload?.alertId || null;
}

function getExecutionAuditId(signal) {
  return signal?.payload?.raw?.executionAuditId || signal?.payload?.executionAuditId || null;
}

function resolveSignalSymbol(signal) {
  const fromPayload = signal?.payload?.raw?.symbol || signal?.payload?.symbol || null;
  const symbol = String(signal?.symbol || fromPayload || '').trim().toUpperCase();
  return symbol || null;
}

function resolveClientOrderId(signal) {
  return (
    signal?.payload?.raw?.clientOrderId ||
    signal?.payload?.raw?.client_id ||
    signal?.payload?.raw?.order_id ||
    signal?.payload?.raw?.id ||
    signal?.idempotencyKey ||
    null
  );
}

async function markAlertStatus(alertId, status, message = null) {
  if (!alertId) return;
  try {
    await updateTradingviewAlertStatus(alertId, status, message);
  } catch {
    // Never block execution on alert bookkeeping.
  }
}

async function markExecutionAudit(auditId, patch) {
  if (!auditId) return;
  try {
    await updateExecutionAudit(auditId, patch);
    debugExecution('audit_updated', {
      auditId,
      status: patch?.status || null
    });
  } catch {
    // Never block execution on audit bookkeeping.
  }
}

async function markSignalExecutionError({
  signalId,
  alertId,
  auditId,
  message,
  auditStatus = EXECUTION_AUDIT_STATUS.ERROR,
  sizingDebug = undefined
}) {
  debugExecution('executed', {
    auditId: auditId || null,
    status: auditStatus,
    error: message
  });
  await markAlertStatus(alertId, 'failed', message);
  const auditPatch = {
    status: auditStatus,
    errorMessage: message
  };
  if (sizingDebug !== undefined) {
    auditPatch.sizingDebug = sizingDebug;
    if (sizingDebug && typeof sizingDebug === 'object') {
      if (Object.prototype.hasOwnProperty.call(sizingDebug, 'qtyRaw')) {
        auditPatch.qtyRaw = sizingDebug.qtyRaw;
      }
      if (Object.prototype.hasOwnProperty.call(sizingDebug, 'qtyAfterStepRounding')) {
        auditPatch.qtyRounded = sizingDebug.qtyAfterStepRounding;
      } else if (Object.prototype.hasOwnProperty.call(sizingDebug, 'qtyRounded')) {
        auditPatch.qtyRounded = sizingDebug.qtyRounded;
      }
    }
  }
  await markExecutionAudit(auditId, auditPatch);
  await prisma.forwardedSignal.update({
    where: { id: signalId },
    data: {
      status: 'executed_error',
      error: message,
      attempts: { increment: 1 }
    }
  });
  return { ok: false, error: message, retry: false };
}

async function placeOrderBestEffort(exchange, n) {
  const params = {
    symbol: n.symbol,
    side: n.side,
    type: n.type || 'MARKET',
    amount: n.amount || 0,
    qty: n.qty || n.amount || 0,
    quantity: n.quantity || n.qty || n.amount || 0,
    price: n.price,
    clientOrderId: n.clientOrderId,
    exchange: n.exchange,
    environment: n.environment,
    raw: n.raw
  };
  if (!params.symbol || !params.side) {
    throw new Error('Missing symbol/side in alert payload');
  }
  if (typeof exchange.submitSignal === 'function') return exchange.submitSignal(params);
  if (typeof exchange.createOrder === 'function') return exchange.createOrder(params);
  if (typeof exchange.placeOrder === 'function') return exchange.placeOrder(params);
  if (typeof exchange.order === 'function') return exchange.order(params);
  if (typeof exchange.trade === 'function') return exchange.trade(params);
  throw new Error('Exchange adapter does not support order placement');
}

export async function executePreparedSignal(signalId) {
  if (!signalId) return null;
  const signal = await prisma.forwardedSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error('Signal not found');
  if (!['ready_for_execution', 'retrying'].includes(signal.status)) {
    return { skipped: true, reason: 'status_not_ready' };
  }

  const alertId = getAlertId(signal);
  const executionAuditId = getExecutionAuditId(signal);

  if (!signal.integrationId) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Missing integration for execution',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  const integration = await prisma.integration.findUnique({
    where: { id: signal.integrationId },
    include: {
      credentials: {
        orderBy: { updatedAt: 'desc' },
        take: 1
      }
    }
  });
  const activeCredential = integration?.credentials?.[0];
  if (!integration || !activeCredential) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Integration credentials missing',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  const symbol = resolveSignalSymbol(signal);
  const side = normalizeSide(signal.side || signal?.payload?.side || signal?.payload?.raw?.side);
  let orderType = resolveSignalOrderType(signal);

  if (!symbol || !side) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Mapped order incomplete: symbol/side missing',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  try {
    if (isDryRun) {
      const dryRunResult = {
        dryRun: true,
        symbol,
        side,
        type: orderType
      };
      await markAlertStatus(alertId, 'executed', 'Dry-run execution');
      await markExecutionAudit(executionAuditId, {
        status: EXECUTION_AUDIT_STATUS.SENT,
        mexcStatus: 'DRY_RUN',
        mexcRawResponse: dryRunResult
      });
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult: dryRunResult },
          executedAt: new Date()
        }
      });
      return { ok: true, dryRun: true };
    }

    const apiKey = decryptRequired(activeCredential.apiKey, 'API key');
    const apiSecret = decryptRequired(activeCredential.apiSecret, 'API secret');
    const passphrase = decryptOptional(activeCredential.passphrase);
    const clientOrderId = resolveClientOrderId(signal);

    const isMexc = String(integration.exchange || '').toLowerCase() === 'mexc';
    let result;

    if (isMexc) {
      const mexcClient = createMexcSpotClient({ apiKey, apiSecret });
      const runtimeBot = await resolveRuntimeTradeBotForIntegration(integration.workspaceId, integration.id);
      const runtimeOrderType = normalizeOrderType(runtimeBot.runtimeOrderType, null);
      const enforceLimitOnlyOrderTypes = runtimeBot.arnLimitOnly || hasArnLimitOnlySignalHints(signal);
      if (orderType === 'MARKET' && hasLimitOrderHints(signal)) {
        orderType = 'LIMIT';
      }
      const orderTypeCoercedForLimitOnly = enforceLimitOnlyOrderTypes && orderType === 'MARKET';
      if (orderTypeCoercedForLimitOnly) {
        orderType = isLimitOrderType(runtimeOrderType) ? runtimeOrderType : 'LIMIT';
      }

      const supportedOrderTypes = new Set(['MARKET', 'LIMIT', 'LIMIT_MAKER']);
      if (!supportedOrderTypes.has(orderType)) {
        return markSignalExecutionError({
          signalId,
          alertId,
          auditId: executionAuditId,
          message: `Unsupported orderType for TradingView -> MEXC path: ${orderType}`,
          auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
        });
      }
      if (enforceLimitOnlyOrderTypes && !isLimitOrderType(orderType)) {
        return markSignalExecutionError({
          signalId,
          alertId,
          auditId: executionAuditId,
          message: 'ARN limit-only bot supports only LIMIT or LIMIT_MAKER order types',
          auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
        });
      }
      if (
        String(signal.type || '').toLowerCase() !== String(orderType || '').toLowerCase() ||
        String(signal?.payload?.type || '').toLowerCase() !== String(orderType || '').toLowerCase() ||
        String(signal?.payload?.orderType || '').toUpperCase() !== String(orderType || '').toUpperCase()
      ) {
        const existingPayload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
        const normalizedType = String(orderType || '').toLowerCase();
        signal.type = normalizedType || signal.type;
        signal.payload = {
          ...existingPayload,
          type: normalizedType || existingPayload.type,
          orderType: orderType || existingPayload.orderType
        };
        try {
          await prisma.forwardedSignal.update({
            where: { id: signalId },
            data: {
              type: normalizedType || signal.type || null,
              payload: signal.payload
            }
          });
        } catch {
          // Do not fail execution due to payload bookkeeping write.
        }
      }
      await markExecutionAudit(executionAuditId, {
        parsedPayload: {
          ...(signal?.payload && typeof signal.payload === 'object' ? signal.payload : {}),
          symbol,
          side,
          orderType,
          type: String(orderType || '').toLowerCase()
        }
      });

      const payloadSizingRequested = hasSignalPayloadSizingHint(signal);
      const payloadSizingRequest = extractSignalPayloadSizingRequest(signal);
      const hasRequestedPayloadSizing =
        (payloadSizingRequest.requestedQty && payloadSizingRequest.requestedQty > 0) ||
        (payloadSizingRequest.requestedAmount && payloadSizingRequest.requestedAmount > 0);
      let payloadSizingApplied = runtimeBot.arnOriginal && payloadSizingRequested && hasRequestedPayloadSizing;
      const preResolvedLimitPrice = isLimitOrderType(orderType)
        ? resolveSignalLimitPrice(signal, side, null)
        : null;
      let requestedQtyForPayloadSizing = payloadSizingRequest.requestedQty;
      let requestedAmountForPayloadSizing = payloadSizingRequest.requestedAmount;
      let arnBalanceSizing = null;
      if (runtimeBot.arnLimitOnly) {
        arnBalanceSizing = await resolveArnLimitOnlyBalanceSizing({
          client: mexcClient,
          symbol,
          investmentPct: runtimeBot.runtimeInvestmentPct
        });
        requestedQtyForPayloadSizing = null;
        requestedAmountForPayloadSizing = arnBalanceSizing.requestedAmount;
        payloadSizingApplied = true;
      }
      if (runtimeBot.arnLimitOnly && (!requestedAmountForPayloadSizing || requestedAmountForPayloadSizing <= 0)) {
        return markSignalExecutionError({
          signalId,
          alertId,
          auditId: executionAuditId,
          message: 'ARN limit-only computed quote amount is zero. Check exchange balances.',
          auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
        });
      }
      const ignoredPayloadSizing = payloadSizingRequested && !payloadSizingApplied;

      const sizing = payloadSizingApplied
        ? await computeMexcBaseQuantityFromSignalPayload({
            symbol,
            side,
            client: mexcClient,
            requestedQty: requestedQtyForPayloadSizing,
            requestedAmount: requestedAmountForPayloadSizing
          })
        : await computeMexcBaseQuantityForSignal({
            workspaceId: integration.workspaceId,
            integrationId: integration.id,
            symbol,
            side,
            client: mexcClient
          });
      const effectiveSizingSource = payloadSizingApplied
        ? (runtimeBot.arnLimitOnly ? 'balance_pct_arn_limit_only' : 'pine_payload_arn_original')
        : sizing.sizingSource || 'trade_bot_runtime';
      const resolvedAuditBotId = runtimeBot.botId || integration.id;
      const limitPrice = isLimitOrderType(orderType)
        ? (preResolvedLimitPrice && preResolvedLimitPrice > 0
            ? preResolvedLimitPrice
            : resolveSignalLimitPrice(signal, side, sizing.computedPrice))
        : null;
      if (isLimitOrderType(orderType) && (!limitPrice || limitPrice <= 0)) {
        return markSignalExecutionError({
          signalId,
          alertId,
          auditId: executionAuditId,
          message: 'Missing valid limitPrice for LIMIT/LIMIT_MAKER order',
          auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
        });
      }

      await markExecutionAudit(executionAuditId, {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        botId: resolvedAuditBotId,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        qtyRaw: sizing.qtyRaw,
        qtyRounded: sizing.qtyRounded,
        sizingDebug: {
          ...(sizing.sizingDebug || {}),
          sizingSource: effectiveSizingSource,
          payloadSizingRequested,
          payloadSizingApplied,
          ignoredPayloadSizing,
          runtimeBotId: runtimeBot.botId || null,
          runtimeBotName: runtimeBot.botName || null,
          runtimeBotStrategy: runtimeBot.strategy || null,
          runtimeBotArnOriginal: runtimeBot.arnOriginal === true,
          runtimeBotArnLimitOnly: runtimeBot.arnLimitOnly === true,
          limitOnlyEnforcedBySignalHints: runtimeBot.arnLimitOnly !== true && enforceLimitOnlyOrderTypes,
          runtimeOrderType: runtimeOrderType || null,
          runtimeInvestmentPct: runtimeBot.runtimeInvestmentPct ?? null,
          arnInvestmentPct: arnBalanceSizing?.investmentPct ?? null,
          arnAccountEquityQuote: arnBalanceSizing?.equityQuote ?? null,
          arnRequestedQuoteAmount: arnBalanceSizing?.requestedAmount ?? null,
          orderTypeResolved: orderType,
          orderTypeCoercedForLimitOnly,
          limitPrice: limitPrice || null
        }
      });

      if (orderType === 'MARKET') {
        result = await mexcClient.placeMarketOrderBaseQty({
          symbol,
          side,
          quantity: sizing.qtyRounded,
          newClientOrderId: clientOrderId
        });
      } else {
        result = await mexcClient.placeLimitOrderBaseQty({
          symbol,
          side,
          quantity: sizing.qtyRounded,
          price: limitPrice,
          orderType,
          newClientOrderId: clientOrderId
        });
      }

      const mexcOrderId = result?.orderId || result?.id || null;
      let mexcStatus = result?.status || 'SENT';
      let finalAuditStatus = EXECUTION_AUDIT_STATUS.SENT;
      let orderSnapshot = null;

      if (mexcOrderId) {
        try {
          orderSnapshot = await mexcClient.getOrder({ symbol, orderId: mexcOrderId });
          mexcStatus = orderSnapshot?.status || mexcStatus;
          if (String(mexcStatus).toUpperCase() === 'FILLED') {
            finalAuditStatus = EXECUTION_AUDIT_STATUS.FILLED;
          }
        } catch {
          // keep SENT state if immediate order lookup fails.
        }
      }

      await markExecutionAudit(executionAuditId, {
        status: finalAuditStatus,
        mexcOrderId: mexcOrderId ? String(mexcOrderId) : null,
        mexcStatus,
        mexcRawResponse: orderSnapshot || result,
        errorMessage: null
      });
      debugExecution('executed', {
        auditId: executionAuditId || null,
        status: finalAuditStatus,
        mexcOrderId: mexcOrderId ? String(mexcOrderId) : null
      });

      const executionResult = {
        ...toJsonSafe(result),
        provider: 'mexc-direct',
        amountMode: 'base',
        orderType,
        limitPrice: limitPrice || null,
        sizingSource: effectiveSizingSource,
        payloadSizingRequested,
        payloadSizingApplied,
        ignoredPayloadSizing,
        quantity: sizing.qtyRounded,
        qtyRaw: sizing.qtyRaw,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        quoteAsset: sizing.quoteAsset,
        runtimeBotId: runtimeBot.botId || null,
        runtimeBotName: runtimeBot.botName || null
      };

      await markAlertStatus(alertId, 'executed', null);
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult },
          executedAt: new Date(),
          error: null
        }
      });

      const signalPayload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
      const signalRaw = signalPayload?.raw && typeof signalPayload.raw === 'object' ? signalPayload.raw : {};
      const fills = Array.isArray(orderSnapshot?.fills)
        ? orderSnapshot.fills
        : Array.isArray(result?.fills)
          ? result.fills
          : [];
      const firstFill = fills[0] || null;
      const resolvedQuantity = parseNumeric(orderSnapshot?.executedQty ?? result?.executedQty ?? sizing.qtyRounded);
      const resolvedValue = parseNumeric(orderSnapshot?.cummulativeQuoteQty ?? result?.cummulativeQuoteQty ?? result?.quoteQty);
      const explicitExecutionPrice = parseNumeric(orderSnapshot?.price ?? result?.price);
      const resolvedExecutionPrice =
        explicitExecutionPrice && explicitExecutionPrice > 0
          ? explicitExecutionPrice
          : resolvedValue && resolvedQuantity && resolvedQuantity > 0
            ? resolvedValue / resolvedQuantity
            : null;

      try {
        await recordTradeTransaction({
          workspaceId: integration.workspaceId,
          botId: signalRaw?.botId || signalPayload?.botId || null,
          botInstanceId: signalRaw?.botInstanceId || signalPayload?.botInstanceId || null,
          orderId: null,
          executionAuditId: executionAuditId || null,
          forwardedSignalId: signal.id,
          integrationId: integration.id,
          exchangeAccountId: signalRaw?.exchangeAccountId || signalPayload?.exchangeAccountId || null,
          venue: integration.exchange || 'mexc',
          symbol,
          side,
          orderType,
          status: String(mexcStatus || finalAuditStatus || 'sent').toLowerCase(),
          amount: parseNumeric(sizing.qtyRaw ?? sizing.qtyRounded),
          quantity: resolvedQuantity,
          value: resolvedValue,
          marketPrice: parseNumeric(sizing.computedPrice),
          executionPrice: resolvedExecutionPrice,
          feeAmount: parseNumeric(firstFill?.commission),
          feeAsset: firstFill?.commissionAsset || null,
          accountBalanceBefore: parseNumeric(sizing.freeQuote),
          balanceAsset: sizing.quoteAsset || null,
          decisionContext: toJsonSafe({
            source: 'tradingview_forwarder',
            signalType: signal.type || null,
            orderTypeResolved: orderType,
            orderTypeCoercedForLimitOnly,
            payloadSizingRequested,
            payloadSizingApplied,
            ignoredPayloadSizing,
            idempotencyKey: signal.idempotencyKey || null
          }),
          sizingContext: toJsonSafe({
            qtyRaw: sizing.qtyRaw,
            qtyRounded: sizing.qtyRounded,
            computedPrice: sizing.computedPrice,
            freeQuote: sizing.freeQuote,
            sizingSource: effectiveSizingSource,
            sizingDebug: sizing.sizingDebug || {}
          }),
          exchangePayload: toJsonSafe({
            placeOrderResult: result,
            orderSnapshot
          }),
          metadata: toJsonSafe({
            alertId,
            clientOrderId,
            mexcOrderId: mexcOrderId ? String(mexcOrderId) : null,
            flow: 'executePreparedSignal.mexc'
          }),
          executedAt: orderSnapshot?.updateTime || result?.transactTime || new Date()
        });
      } catch (ledgerError) {
        // Never block execution on ledger writes.
        logLedgerWriteError(ledgerError, {
          flow: 'executePreparedSignal.mexc',
          signalId,
          executionAuditId: executionAuditId || null,
          integrationId: integration.id,
          symbol,
          side
        });
      }

      return { ok: true, result: executionResult };
    }

    const fallbackAmount = parseNumeric(signal.amount ?? signal.payload?.amount ?? signal.payload?.raw?.amount);
    if (!fallbackAmount || fallbackAmount <= 0) {
      return markSignalExecutionError({
        signalId,
        alertId,
        auditId: executionAuditId,
        message: 'Base quantity missing for non-MEXC execution path',
        auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
      });
    }

    const exchangeClient = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey,
      apiSecret,
      passphrase
    });
    result = await placeOrderBestEffort(exchangeClient, {
      symbol,
      side,
      type: orderType,
      amount: fallbackAmount,
      qty: fallbackAmount,
      quantity: fallbackAmount,
      clientOrderId,
      exchange: integration.exchange,
      environment: integration.environment,
      raw: signal.payload || {}
    });

    await markAlertStatus(alertId, 'executed', null);
    await markExecutionAudit(executionAuditId, {
      status: EXECUTION_AUDIT_STATUS.SENT,
      mexcStatus: 'SENT',
      mexcRawResponse: result,
      errorMessage: null
    });
    debugExecution('executed', {
      auditId: executionAuditId || null,
      status: EXECUTION_AUDIT_STATUS.SENT
    });
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: 'executed_success',
        payload: { ...(signal.payload || {}), executionResult: result },
        executedAt: new Date(),
        error: null
      }
    });

    const signalPayload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
    const signalRaw = signalPayload?.raw && typeof signalPayload.raw === 'object' ? signalPayload.raw : {};
    try {
      await recordTradeTransaction({
        workspaceId: integration.workspaceId,
        botId: signalRaw?.botId || signalPayload?.botId || null,
        botInstanceId: signalRaw?.botInstanceId || signalPayload?.botInstanceId || null,
        orderId: null,
        executionAuditId: executionAuditId || null,
        forwardedSignalId: signal.id,
        integrationId: integration.id,
        exchangeAccountId: signalRaw?.exchangeAccountId || signalPayload?.exchangeAccountId || null,
        venue: integration.exchange || null,
        symbol,
        side,
        orderType,
        status: 'sent',
        amount: fallbackAmount,
        quantity: fallbackAmount,
        value: parseNumeric(result?.cummulativeQuoteQty ?? result?.quoteQty ?? result?.cost),
        marketPrice: parseNumeric(signal.price ?? signalPayload?.price ?? signalRaw?.price),
        executionPrice: parseNumeric(result?.price ?? signal.price ?? signalPayload?.price ?? signalRaw?.price),
        feeAmount: parseNumeric(result?.fee?.cost ?? result?.feeAmount),
        feeAsset: result?.fee?.currency || result?.feeAsset || null,
        decisionContext: toJsonSafe({
          source: 'tradingview_forwarder',
          idempotencyKey: signal.idempotencyKey || null
        }),
        sizingContext: toJsonSafe({
          mode: 'fallback_amount',
          fallbackAmount
        }),
        exchangePayload: toJsonSafe(result),
        metadata: toJsonSafe({
          alertId,
          clientOrderId,
          flow: 'executePreparedSignal.generic'
        }),
        executedAt: result?.transactTime || result?.timestamp || new Date()
      });
    } catch (ledgerError) {
      // Never block execution on ledger writes.
      logLedgerWriteError(ledgerError, {
        flow: 'executePreparedSignal.generic',
        signalId,
        executionAuditId: executionAuditId || null,
        integrationId: integration.id,
        symbol,
        side
      });
    }

    return { ok: true, result };
  } catch (err) {
    const message = err?.message || String(err);
    const auditStatus = err instanceof SizingConfigError
      ? EXECUTION_AUDIT_STATUS.REJECTED
      : EXECUTION_AUDIT_STATUS.ERROR;
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message,
      auditStatus,
      sizingDebug: err?.sizingDebug
    });
  }
}
