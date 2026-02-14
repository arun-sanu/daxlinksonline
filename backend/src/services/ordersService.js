import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { extractSymbolFilters } from './mexcSpotClient.js';

const MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const DEFAULT_RECV_WINDOW_RAW = Number(process.env.MEXC_RECV_WINDOW || 5000);
const DEFAULT_TRADES_LIMIT_RAW = Number(process.env.MEXC_MY_TRADES_LIMIT || 30);
const DEFAULT_RECV_WINDOW =
  Number.isFinite(DEFAULT_RECV_WINDOW_RAW) && DEFAULT_RECV_WINDOW_RAW > 0 ? DEFAULT_RECV_WINDOW_RAW : 5000;
const DEFAULT_TRADES_LIMIT =
  Number.isFinite(DEFAULT_TRADES_LIMIT_RAW) && DEFAULT_TRADES_LIMIT_RAW > 0 ? Math.min(DEFAULT_TRADES_LIMIT_RAW, 1000) : 30;
const MAX_BALANCES = 10;
const DEFAULT_ATR_LENGTH = 14;
const DEFAULT_KLINE_INTERVAL = '5m';
const SUPPORTED_KLINE_INTERVALS = new Set([
  '1m',
  '5m',
  '15m',
  '30m',
  '60m',
  '4h',
  '1d'
]);
const DEFAULT_REPORT_LIMIT = 25;
const MAX_REPORT_LIMIT = 100;
const EMPTY_REPORT_SUMMARY = Object.freeze({
  executed: 0,
  rejected: 0,
  pending: 0,
  retried: 0,
  unmatched: 0
});

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function normalizeKlineInterval(value) {
  const raw = String(value || DEFAULT_KLINE_INTERVAL)
    .trim()
    .toLowerCase();
  const aliases = {
    '1': '1m',
    '1min': '1m',
    '5': '5m',
    '5min': '5m',
    '15': '15m',
    '15min': '15m',
    '30': '30m',
    '30min': '30m',
    '1h': '60m',
    '60': '60m',
    '60m': '60m',
    '4h': '4h',
    '1d': '1d',
    '24h': '1d',
    '1day': '1d'
  };
  const normalized = aliases[raw] || raw;
  return SUPPORTED_KLINE_INTERVALS.has(normalized) ? normalized : DEFAULT_KLINE_INTERVAL;
}

function normalizeAtrLength(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 2) return DEFAULT_ATR_LENGTH;
  return Math.min(Math.floor(n), 200);
}

function compactParams(input) {
  const params = new URLSearchParams();
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });
  return params;
}

function settle(promise) {
  return promise
    .then((value) => ({ status: 'fulfilled', value }))
    .catch((reason) => ({ status: 'rejected', reason }));
}

async function mexcSignedGet(credentials, path, params = {}) {
  const signedParams = compactParams({
    ...params,
    recvWindow: DEFAULT_RECV_WINDOW,
    timestamp: Date.now()
  });
  const signature = crypto.createHmac('sha256', credentials.apiSecret).update(signedParams.toString()).digest('hex');
  signedParams.append('signature', signature);

  const res = await fetch(`${MEXC_BASE_URL}${path}?${signedParams.toString()}`, {
    method: 'GET',
    headers: { 'X-MEXC-APIKEY': credentials.apiKey }
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.msg || payload?.message || text || `MEXC request failed (${res.status})`;
    throw Object.assign(new Error(detail), { status: res.status, payload });
  }
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
    const detail = payload.msg || payload.message || `MEXC request failed with code ${payload.code}`;
    throw Object.assign(new Error(detail), { status: 502, payload });
  }
  return payload;
}

async function mexcPublicGet(path, params = {}) {
  const query = compactParams(params).toString();
  const url = query ? `${MEXC_BASE_URL}${path}?${query}` : `${MEXC_BASE_URL}${path}`;
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.msg || payload?.message || text || `MEXC request failed (${res.status})`;
    throw Object.assign(new Error(detail), { status: res.status, payload });
  }
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
    const detail = payload.msg || payload.message || `MEXC request failed with code ${payload.code}`;
    throw Object.assign(new Error(detail), { status: 502, payload });
  }
  return payload;
}

async function findMexcIntegration(workspaceId, integrationId) {
  const integration = await prisma.integration.findFirst({
    where: {
      workspaceId,
      ...(integrationId ? { id: integrationId } : {}),
      exchange: { equals: 'mexc', mode: 'insensitive' },
      ...(integrationId ? {} : { credential: { isNot: null } })
    },
    include: { credential: true },
    orderBy: { updatedAt: 'desc' }
  });

  if (!integration) {
    throw Object.assign(new Error('No connected MEXC integration found for this workspace.'), { status: 404 });
  }
  if (!integration.credential) {
    throw Object.assign(new Error('MEXC credentials are missing for the selected integration.'), { status: 400 });
  }
  return integration;
}

function mapBalances(accountPayload) {
  const balances = Array.isArray(accountPayload?.balances) ? accountPayload.balances : [];
  const assets = balances
    .map((row) => {
      const free = asNumber(row.free);
      const locked = asNumber(row.locked);
      return {
        asset: String(row.asset || '').toUpperCase(),
        free,
        locked,
        total: free + locked
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    assets,
    topAssets: assets.slice(0, MAX_BALANCES),
    assetsWithFunds: assets.length
  };
}

function summarizeTrades(tradesPayload) {
  const trades = Array.isArray(tradesPayload) ? tradesPayload : [];
  const totalQty = trades.reduce((sum, trade) => sum + asNumber(trade.qty), 0);
  const totalQuoteQty = trades.reduce((sum, trade) => sum + asNumber(trade.quoteQty), 0);
  const latest = trades.reduce((latestTs, trade) => {
    const ts = asNumber(trade.time);
    return ts > latestTs ? ts : latestTs;
  }, 0);

  return {
    count: trades.length,
    totalQty,
    totalQuoteQty,
    latestTradeAt: latest ? new Date(latest).toISOString() : null,
    items: trades.slice(0, DEFAULT_TRADES_LIMIT)
  };
}

function summarizeOpenOrders(openOrdersPayload, query) {
  const orders = Array.isArray(openOrdersPayload) ? openOrdersPayload : [];
  const matching = orders.filter((order) => {
    if (query.orderId && String(order.orderId) !== String(query.orderId)) return false;
    if (query.origClientOrderId && String(order.clientOrderId || order.origClientOrderId) !== String(query.origClientOrderId)) {
      return false;
    }
    return true;
  });

  const isOpen =
    query.orderId || query.origClientOrderId
      ? matching.length > 0
      : orders.length > 0;

  return {
    isOpen,
    countForSymbol: orders.length,
    matchingCount: matching.length,
    matchingOrders: matching.slice(0, 20),
    items: orders.slice(0, 50)
  };
}

function summarizeOrderCheck(orderPayload) {
  if (!orderPayload || typeof orderPayload !== 'object') {
    return { found: false, executedQty: 0, status: null, raw: null };
  }
  const executedQty = asNumber(orderPayload.executedQty);
  return {
    found: true,
    status: orderPayload.status || null,
    side: orderPayload.side || null,
    type: orderPayload.type || null,
    price: asNumber(orderPayload.price),
    origQty: asNumber(orderPayload.origQty),
    executedQty,
    cummulativeQuoteQty: asNumber(orderPayload.cummulativeQuoteQty),
    updateTime: orderPayload.updateTime ? new Date(Number(orderPayload.updateTime)).toISOString() : null,
    raw: orderPayload
  };
}

function inferSpotExposure(balanceSummary, openOrdersSummary) {
  const holdings = balanceSummary.assets.slice(0, 20).map((asset) => ({
    asset: asset.asset,
    total: asset.total,
    free: asset.free,
    locked: asset.locked
  }));

  return {
    inferredFromSpotModel: true,
    note: 'Spot exchanges do not expose separate position objects. Exposure is inferred from balances and open orders.',
    holdings,
    openOrdersCount: openOrdersSummary.countForSymbol
  };
}

function extractOrderParams(query) {
  const params = {};
  if (query.orderId) params.orderId = query.orderId;
  if (query.origClientOrderId) params.origClientOrderId = query.origClientOrderId;
  return params;
}

function formatSectionError(error) {
  return {
    ok: false,
    error: error?.message || 'Request failed'
  };
}

function mapBookTicker(payload = {}) {
  const bid = asNumber(payload?.bidPrice);
  const ask = asNumber(payload?.askPrice);
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  return {
    symbol: String(payload?.symbol || '').toUpperCase(),
    bid: bid > 0 ? bid : null,
    ask: ask > 0 ? ask : null,
    mid: mid > 0 ? mid : null
  };
}

function mapKlineRows(payload = []) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const openTime = asNumber(row[0]);
      const open = asNumber(row[1]);
      const high = asNumber(row[2]);
      const low = asNumber(row[3]);
      const close = asNumber(row[4]);
      const closeTime = asNumber(row[6]);
      if (!(high > 0) || !(low > 0) || !(close > 0)) return null;
      return {
        openTime: openTime > 0 ? new Date(openTime).toISOString() : null,
        closeTime: closeTime > 0 ? new Date(closeTime).toISOString() : null,
        open,
        high,
        low,
        close
      };
    })
    .filter(Boolean);
}

function computeAtr(klines = [], atrLength = DEFAULT_ATR_LENGTH) {
  if (!Array.isArray(klines) || klines.length < 2) return null;
  const len = normalizeAtrLength(atrLength);
  const trValues = [];
  for (let i = 1; i < klines.length; i += 1) {
    const current = klines[i];
    const previous = klines[i - 1];
    const high = asNumber(current?.high);
    const low = asNumber(current?.low);
    const prevClose = asNumber(previous?.close);
    if (!(high > 0) || !(low > 0) || !(prevClose > 0)) continue;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    if (Number.isFinite(tr) && tr > 0) trValues.push(tr);
  }
  if (trValues.length < len) return null;
  const slice = trValues.slice(-len);
  const value = slice.reduce((sum, item) => sum + item, 0) / len;
  return {
    length: len,
    value,
    sampleCount: slice.length
  };
}

export async function getMexcSpotSnapshot({
  workspaceId,
  integrationId,
  symbol,
  orderId,
  origClientOrderId,
  interval,
  atrLength
}) {
  const integration = await findMexcIntegration(workspaceId, integrationId);
  const credentials = {
    apiKey: decrypt(integration.credential.apiKey),
    apiSecret: decrypt(integration.credential.apiSecret)
  };

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedInterval = normalizeKlineInterval(interval);
  const normalizedAtrLength = normalizeAtrLength(atrLength);
  const orderQuery = {
    symbol: normalizedSymbol,
    orderId: orderId ? String(orderId) : undefined,
    origClientOrderId: origClientOrderId ? String(origClientOrderId) : undefined,
    interval: normalizedInterval,
    atrLength: normalizedAtrLength
  };

  const accountPromise = mexcSignedGet(credentials, '/api/v3/account');
  const openOrdersPromise = normalizedSymbol
    ? mexcSignedGet(credentials, '/api/v3/openOrders', { symbol: normalizedSymbol })
    : Promise.resolve([]);
  const tradesPromise = normalizedSymbol
    ? mexcSignedGet(credentials, '/api/v3/myTrades', { symbol: normalizedSymbol, limit: DEFAULT_TRADES_LIMIT })
    : Promise.resolve([]);
  const tickerPromise = normalizedSymbol
    ? mexcPublicGet('/api/v3/ticker/price', { symbol: normalizedSymbol })
    : Promise.resolve(null);
  const bookTickerPromise = normalizedSymbol
    ? mexcPublicGet('/api/v3/ticker/bookTicker', { symbol: normalizedSymbol })
    : Promise.resolve(null);
  const exchangeInfoPromise = normalizedSymbol
    ? mexcPublicGet('/api/v3/exchangeInfo', { symbol: normalizedSymbol })
    : Promise.resolve(null);
  const klinePromise = normalizedSymbol
    ? mexcPublicGet('/api/v3/klines', {
        symbol: normalizedSymbol,
        interval: normalizedInterval,
        limit: Math.max(normalizedAtrLength + 2, 50)
      })
    : Promise.resolve([]);
  const orderPromise =
    normalizedSymbol && (orderQuery.orderId || orderQuery.origClientOrderId)
      ? mexcSignedGet(credentials, '/api/v3/order', {
          symbol: normalizedSymbol,
          ...extractOrderParams(orderQuery)
        })
      : Promise.resolve(null);

  const [accountResult, openOrdersResult, tradesResult, tickerResult, bookTickerResult, exchangeInfoResult, klineResult, orderResult] = await Promise.all([
    settle(accountPromise),
    settle(openOrdersPromise),
    settle(tradesPromise),
    settle(tickerPromise),
    settle(bookTickerPromise),
    settle(exchangeInfoPromise),
    settle(klinePromise),
    settle(orderPromise)
  ]);

  const accountOk = accountResult.status === 'fulfilled';
  const openOrdersOk = openOrdersResult.status === 'fulfilled';
  const tradesOk = tradesResult.status === 'fulfilled';
  const tickerOk = tickerResult.status === 'fulfilled';
  const bookTickerOk = bookTickerResult.status === 'fulfilled';
  const exchangeInfoOk = exchangeInfoResult.status === 'fulfilled';
  const klineOk = klineResult.status === 'fulfilled';
  const orderOk = orderResult.status === 'fulfilled';

  const balances = accountOk ? mapBalances(accountResult.value) : null;
  const openOrders = openOrdersOk ? summarizeOpenOrders(openOrdersResult.value, orderQuery) : null;
  const trades = tradesOk ? summarizeTrades(tradesResult.value) : null;
  const ticker = tickerOk
    ? {
        symbol: String(tickerResult.value?.symbol || normalizedSymbol || '').toUpperCase(),
        price: asNumber(tickerResult.value?.price)
      }
    : null;
  const bookTicker = bookTickerOk ? mapBookTicker(bookTickerResult.value) : null;
  const prices = ticker || bookTicker
    ? {
        last: ticker && ticker.price > 0 ? ticker.price : null,
        bid: bookTicker?.bid || null,
        ask: bookTicker?.ask || null,
        mid: bookTicker?.mid || null,
        mark: (bookTicker?.mid && bookTicker.mid > 0 ? bookTicker.mid : ticker?.price) || null
      }
    : null;
  const symbolFilters = exchangeInfoOk ? extractSymbolFilters(exchangeInfoResult.value, normalizedSymbol) : null;
  const klines = klineOk ? mapKlineRows(klineResult.value) : [];
  const atr = computeAtr(klines, normalizedAtrLength);
  const order = orderOk ? summarizeOrderCheck(orderResult.value) : null;

  const didTradeHappen = Boolean((order?.executedQty || 0) > 0 || (trades?.count || 0) > 0);
  const isOpen = openOrders ? openOrders.isOpen : null;

  return {
    ok: accountOk || openOrdersOk || tradesOk || orderOk,
    checkedAt: new Date().toISOString(),
    exchange: 'mexc',
    integration: {
      id: integration.id,
      label: integration.label || 'MEXC',
      status: integration.status
    },
    query: {
      symbol: normalizedSymbol || null,
      orderId: orderQuery.orderId || null,
      origClientOrderId: orderQuery.origClientOrderId || null,
      interval: normalizedInterval,
      atrLength: normalizedAtrLength
    },
    didTradeHappen: {
      answer: didTradeHappen,
      source: {
        order: orderOk ? { ok: true, data: order } : formatSectionError(orderResult.reason),
        myTrades: tradesOk ? { ok: true, data: trades } : formatSectionError(tradesResult.reason)
      }
    },
    isStillOpen: {
      answer: isOpen,
      source: openOrdersOk ? { ok: true, data: openOrders } : formatSectionError(openOrdersResult.reason)
    },
    market: {
      ticker: normalizedSymbol
        ? tickerOk
          ? { ok: true, data: ticker }
          : formatSectionError(tickerResult.reason)
        : { ok: false, error: 'Symbol is required to fetch ticker price.' },
      prices: normalizedSymbol
        ? tickerOk || bookTickerOk
          ? { ok: true, data: prices }
          : formatSectionError(bookTickerResult.reason || tickerResult.reason)
        : { ok: false, error: 'Symbol is required to fetch market prices.' },
      filters: normalizedSymbol
        ? exchangeInfoOk
          ? { ok: true, data: symbolFilters }
          : formatSectionError(exchangeInfoResult.reason)
        : { ok: false, error: 'Symbol is required to fetch market filters.' },
      atr: normalizedSymbol
        ? klineOk
          ? { ok: true, data: { interval: normalizedInterval, length: normalizedAtrLength, value: atr?.value || null, candles: klines.length } }
          : formatSectionError(klineResult.reason)
        : { ok: false, error: 'Symbol is required to fetch ATR data.' }
    },
    currentBalance: {
      source: accountOk ? { ok: true, data: balances } : formatSectionError(accountResult.reason)
    },
    openPosition: {
      source:
        balances && openOrders
          ? { ok: true, data: inferSpotExposure(balances, openOrders) }
          : {
              ok: false,
              error: 'Open position inference requires account balances and open orders.'
            }
    }
  };
}

function extractAlertId(signal) {
  return signal?.payload?.alertId || signal?.payload?.raw?.alertId || null;
}

function extractSourceId(signal, alert) {
  return (
    alert?.payload?.sourceId ||
    signal?.payload?.sourceId ||
    signal?.payload?.raw?.sourceId ||
    signal?.payload?.source ||
    signal?.payload?.raw?.source ||
    null
  );
}

function mapTradeStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'executed' || normalized === 'done') return 'executed';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'retried') return 'retried';
  if (normalized === 'received') return 'pending';
  if (normalized === 'sent') return 'pending';
  if (normalized === 'filled') return 'executed';
  if (normalized === 'error') return 'rejected';
  if (normalized === 'executed_success' || normalized === 'succeeded') return 'executed';
  if (normalized === 'executed_error' || normalized === 'failed') return 'rejected';
  if (normalized === 'retrying') return 'retried';
  if (normalized === 'ready_for_execution' || normalized === 'queued') return 'pending';
  if (normalized === 'skipped_no_rule') return 'rejected';
  return 'pending';
}

function resolveQuantity(signal) {
  const fromResult = asNumber(
    signal?.payload?.executionResult?.qty ??
      signal?.payload?.executionResult?.quantity ??
      signal?.payload?.executionResult?.origQty ??
      signal?.payload?.executionResult?.executedQty
  );
  if (fromResult > 0) return fromResult;
  const amount = asNumber(signal?.amount);
  return amount > 0 ? amount : 0;
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';
  return null;
}

function positionStateFromQty(qty) {
  if (qty > 1e-12) return 'LONG';
  if (qty < -1e-12) return 'SHORT';
  return 'FLAT';
}

function scoreAlertMatch(signal, alert) {
  const signalSymbol = String(signal?.symbol || signal?.payload?.symbol || signal?.payload?.raw?.symbol || '').toUpperCase();
  const signalSide = String(signal?.side || signal?.payload?.side || signal?.payload?.raw?.side || '').toLowerCase();
  const alertSymbol = String(alert?.symbol || '').toUpperCase();
  const alertSide = String(alert?.side || '').toLowerCase();
  if (!signalSymbol || !alertSymbol || signalSymbol !== alertSymbol) return Infinity;
  if (!signalSide || !alertSide || signalSide !== alertSide) return Infinity;
  const signalTs = new Date(signal.createdAt || signal.executedAt || Date.now()).getTime();
  const alertTs = new Date(alert.receivedAt || Date.now()).getTime();
  const diff = Math.abs(signalTs - alertTs);
  if (diff > 10 * 60 * 1000) return Infinity;
  return diff;
}

function normalizeReportLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REPORT_LIMIT;
  return Math.min(Math.floor(n), MAX_REPORT_LIMIT);
}

function resolveReportErrorMessage(signal, audit) {
  return (
    audit?.errorMessage ||
    signal?.error ||
    signal?.payload?.executionResult?.errorMessage ||
    signal?.payload?.executionResult?.msg ||
    signal?.payload?.executionResult?.message ||
    null
  );
}

function resolveReportOrderId(signal, audit) {
  return (
    signal?.payload?.executionResult?.orderId ||
    signal?.payload?.executionResult?.id ||
    signal?.payload?.executionResult?.clientOrderId ||
    audit?.mexcOrderId ||
    null
  );
}

function resolveReportQuantity(signal, audit) {
  const signalQty = resolveQuantity(signal);
  if (signalQty > 0) return signalQty;
  const auditQty = asNumber(audit?.qtyRounded);
  return auditQty > 0 ? auditQty : 0;
}

function extractSizingFromAudit(audit) {
  if (!audit) return null;
  const sizingDebug = audit?.sizingDebug || null;
  return {
    qtyRaw: audit?.qtyRaw ?? sizingDebug?.qtyRaw ?? null,
    qtyRounded: audit?.qtyRounded ?? sizingDebug?.qtyAfterStepRounding ?? null,
    computedPrice: audit?.computedPrice ?? sizingDebug?.priceUsed ?? null,
    freeQuote: audit?.freeQuote ?? sizingDebug?.freeQuote ?? null,
    freeBase: sizingDebug?.freeBase ?? null,
    quoteSpendComputed: sizingDebug?.quoteSpendComputed ?? null,
    notionalAfterRounding: sizingDebug?.notionalAfterRounding ?? null,
    rejectedReason: sizingDebug?.rejectedReason ?? null,
    sizingDebug
  };
}

function toPlainDecimal(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractSizingSummaryFromOrder(order) {
  if (!order) return null;
  return {
    quoteSpend: toPlainDecimal(order.quoteSpend),
    qtyRaw: toPlainDecimal(order.qtyRaw),
    qtyFinal: toPlainDecimal(order.qtyFinal),
    refPrice: toPlainDecimal(order.refPrice),
    minNotional: toPlainDecimal(order.minNotional),
    stepSize: toPlainDecimal(order.stepSize),
    riskMode: order.riskMode || null,
    riskValue: toPlainDecimal(order.riskValue),
    slPrice: toPlainDecimal(order.slPrice),
    tpPrice: toPlainDecimal(order.tpPrice),
    sizingStatus: order.sizingStatus || null,
    sizingRejectReason: order.sizingRejectReason || null
  };
}

function extractSizingSummaryFromAudit(audit) {
  if (!audit) return null;
  const debug = audit.sizingDebug || {};
  const maybeNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    quoteSpend: maybeNumber(debug.quoteSpendComputed),
    qtyRaw: maybeNumber(audit.qtyRaw ?? debug.qtyRaw),
    qtyFinal: maybeNumber(audit.qtyRounded ?? debug.qtyAfterStepRounding),
    refPrice: maybeNumber(audit.computedPrice ?? debug.priceUsed),
    minNotional: maybeNumber(debug.minNotional),
    stepSize: maybeNumber(debug.stepSize),
    riskMode: debug.riskMode || null,
    riskValue: maybeNumber(debug.riskPctOfFreeQuote),
    slPrice: maybeNumber(debug.slPrice),
    tpPrice: maybeNumber(debug.tpPrice),
    sizingStatus: audit.status ? String(audit.status).toLowerCase() : null,
    sizingRejectReason: debug.rejectedReason || null
  };
}

function mapReportRow(signal, alert, integrationMeta, matchType, positionAfter, audit, linkedOrder = null) {
  const symbol = alert?.symbol || signal?.symbol || signal?.payload?.symbol || signal?.payload?.raw?.symbol || null;
  const side = normalizeSide(alert?.side || signal?.side || signal?.payload?.side || signal?.payload?.raw?.side);
  const signalTimestamp =
    toIso(alert?.receivedAt) ||
    toIso(signal?.payload?.timestamp || signal?.payload?.raw?.timestamp) ||
    toIso(signal?.createdAt);
  const signalTradeStatus = mapTradeStatus(signal.status);
  const auditTradeStatus = mapTradeStatus(audit?.status || audit?.mexcStatus || null);
  const tradeStatus = signalTradeStatus === 'pending' ? auditTradeStatus || signalTradeStatus : signalTradeStatus;
  const alertId = alert?.id || extractAlertId(signal) || signal.id;
  const sentToExchange = Boolean(signal.integrationId);
  const requestTimestamp = toIso(signal?.createdAt);
  const signalAction = side || '—';
  const errorMessage = resolveReportErrorMessage(signal, audit);
  const orderId = resolveReportOrderId(signal, audit);
  const sizingSummary = extractSizingSummaryFromOrder(linkedOrder) || extractSizingSummaryFromAudit(audit);

  return {
    key: signal.id,
    matchType,
    audit: {
      alertId,
      signal: signalAction,
      sentToExchange,
      requestTimestamp,
      retryCount: Number(signal?.attempts || 0),
      finalState: tradeStatus.toUpperCase(),
      daxlinksStatus: String(signal?.status || 'unknown')
    },
    signal: {
      id: alertId,
      sourceId: extractSourceId(signal, alert),
      timestamp: signalTimestamp,
      symbol,
      side: signalAction
    },
    exchange: {
      integrationId: signal.integrationId || null,
      integrationLabel: integrationMeta?.label || integrationMeta?.exchange || 'Integration',
      exchange: integrationMeta?.exchange || null,
      tradeStatus,
      executionTimestamp: toIso(signal.executedAt) || toIso(audit?.updatedAt) || toIso(signal.createdAt),
      side: normalizeSide(signal.side || side || null),
      type: signal.type || signal?.payload?.type || signal?.payload?.raw?.type || null,
      amount: signal.amount ?? null,
      quantity: resolveReportQuantity(signal, audit),
      orderId,
      errorMessage,
      positionAfter: positionAfter || {
        estimatedBaseQty: null,
        state: 'UNKNOWN'
      }
    },
    sizing: extractSizingFromAudit(audit),
    sizingSummary
  };
}

export async function getWorkspaceOrderReport({
  workspaceId,
  integrationId,
  symbol,
  limit = DEFAULT_REPORT_LIMIT
}) {
  const pageSize = normalizeReportLimit(limit);
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true }
  });
  if (!workspace) {
    throw Object.assign(new Error('Workspace not found'), { status: 404 });
  }
  if (!workspace.ownerId) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      total: 0,
      summary: EMPTY_REPORT_SUMMARY,
      items: []
    };
  }

  const integrationRows = await prisma.integration.findMany({
    where: {
      workspaceId,
      ...(integrationId ? { id: integrationId } : {})
    },
    select: { id: true, exchange: true, label: true }
  });
  if (!integrationRows.length) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      total: 0,
      summary: EMPTY_REPORT_SUMMARY,
      items: []
    };
  }
  const integrationIds = integrationRows.map((row) => row.id);
  const integrationMap = integrationRows.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {});

  const signals = await prisma.forwardedSignal.findMany({
    where: {
      integrationId: { in: integrationIds },
      ...(symbol ? { symbol: normalizeSymbol(symbol) } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: pageSize
  });

  if (!signals.length) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      total: 0,
      summary: EMPTY_REPORT_SUMMARY,
      items: []
    };
  }

  const alertIds = Array.from(new Set(signals.map((signal) => extractAlertId(signal)).filter(Boolean)));
  const alertsById = {};
  if (alertIds.length > 0) {
    const alerts = await prisma.tradingviewAlert.findMany({
      where: { id: { in: alertIds } },
      select: {
        id: true,
        receivedAt: true,
        symbol: true,
        side: true,
        payload: true
      }
    });
    alerts.forEach((alert) => {
      alertsById[alert.id] = alert;
    });
  }

  const oldestSignal = signals.reduce((oldest, signal) => {
    if (!oldest) return signal;
    return signal.createdAt < oldest.createdAt ? signal : oldest;
  }, null);
  const fallbackCandidates = await prisma.tradingviewAlert.findMany({
    where: {
      userId: workspace.ownerId,
      receivedAt: oldestSignal?.createdAt
        ? { gte: new Date(oldestSignal.createdAt.getTime() - 20 * 60 * 1000) }
        : undefined
    },
    orderBy: { receivedAt: 'desc' },
    take: pageSize * 4,
    select: {
      id: true,
      receivedAt: true,
      symbol: true,
      side: true,
      payload: true
    }
  });

  const usedFallbackAlertIds = new Set();
  const matchedRows = signals.map((signal) => {
    const alertId = extractAlertId(signal);
    if (alertId && alertsById[alertId]) {
      return { signal, alert: alertsById[alertId], matchType: 'alert_id' };
    }

    let bestAlert = null;
    let bestScore = Infinity;
    fallbackCandidates.forEach((candidate) => {
      if (usedFallbackAlertIds.has(candidate.id)) return;
      const score = scoreAlertMatch(signal, candidate);
      if (score < bestScore) {
        bestScore = score;
        bestAlert = candidate;
      }
    });
    if (bestAlert && Number.isFinite(bestScore)) {
      usedFallbackAlertIds.add(bestAlert.id);
      return { signal, alert: bestAlert, matchType: 'heuristic' };
    }

    return { signal, alert: null, matchType: 'unmatched' };
  });

  const signalIds = signals.map((signal) => signal.id);
  const executionAudits = await prisma.executionAudit.findMany({
    where: {
      forwardedSignalId: { in: signalIds }
    },
    orderBy: { receivedAt: 'desc' },
    select: {
      forwardedSignalId: true,
      status: true,
      errorMessage: true,
      computedPrice: true,
      freeQuote: true,
      qtyRaw: true,
      qtyRounded: true,
      mexcOrderId: true,
      mexcStatus: true,
      updatedAt: true,
      sizingDebug: true
    }
  });
  const auditBySignalId = {};
  executionAudits.forEach((audit) => {
    if (!audit?.forwardedSignalId) return;
    if (!auditBySignalId[audit.forwardedSignalId]) {
      auditBySignalId[audit.forwardedSignalId] = audit;
    }
  });

  const venueOrderIds = Array.from(
    new Set(
      signals
        .map((signal) => resolveReportOrderId(signal, auditBySignalId[signal.id] || null))
        .filter(Boolean)
    )
  );
  const orders = venueOrderIds.length
    ? await prisma.order.findMany({
        where: {
          venueOrderId: { in: venueOrderIds }
        },
        select: {
          id: true,
          venueOrderId: true,
          quoteSpend: true,
          qtyRaw: true,
          qtyFinal: true,
          refPrice: true,
          minNotional: true,
          stepSize: true,
          riskMode: true,
          riskValue: true,
          slPrice: true,
          tpPrice: true,
          sizingStatus: true,
          sizingRejectReason: true
        }
      })
    : [];
  const orderByVenueId = orders.reduce((acc, order) => {
    if (!order.venueOrderId) return acc;
    acc[order.venueOrderId] = order;
    return acc;
  }, {});

  const positionBySignalId = {};
  let runningPositionQty = 0;
  const matchedAsc = [...matchedRows].sort((a, b) => {
    const at = new Date(a.signal.createdAt || 0).getTime();
    const bt = new Date(b.signal.createdAt || 0).getTime();
    return at - bt;
  });
  matchedAsc.forEach((row) => {
    const tradeStatus = mapTradeStatus(row.signal.status);
    const tradeSide = normalizeSide(
      row.signal.side || row.signal?.payload?.side || row.signal?.payload?.raw?.side
    );
    if (tradeStatus === 'executed') {
      const qty = resolveQuantity(row.signal);
      if (tradeSide === 'BUY') runningPositionQty += qty;
      if (tradeSide === 'SELL') runningPositionQty -= qty;
    }
    positionBySignalId[row.signal.id] = {
      estimatedBaseQty: Number(runningPositionQty.toFixed(12)),
      state: positionStateFromQty(runningPositionQty)
    };
  });

  const items = matchedRows.map((row) =>
    {
      const linkedAudit = auditBySignalId[row.signal.id] || null;
      const venueOrderId = resolveReportOrderId(row.signal, linkedAudit);
      const linkedOrder = venueOrderId ? orderByVenueId[venueOrderId] || null : null;
      return mapReportRow(
        row.signal,
        row.alert,
        integrationMap[row.signal.integrationId],
        row.matchType,
        positionBySignalId[row.signal.id],
        linkedAudit,
        linkedOrder
      );
    }
  );

  const summary = items.reduce(
    (acc, row) => {
      const state = String(row?.exchange?.tradeStatus || 'pending').toLowerCase();
      if (state === 'executed') acc.executed += 1;
      else if (state === 'rejected') acc.rejected += 1;
      else if (state === 'retried') acc.retried += 1;
      else acc.pending += 1;
      if (row.matchType === 'unmatched') acc.unmatched += 1;
      return acc;
    },
    { ...EMPTY_REPORT_SUMMARY }
  );

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    total: items.length,
    summary,
    items
  };
}
