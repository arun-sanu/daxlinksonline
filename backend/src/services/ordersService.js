import crypto from 'crypto';
import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';

const MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const DEFAULT_RECV_WINDOW_RAW = Number(process.env.MEXC_RECV_WINDOW || 5000);
const DEFAULT_TRADES_LIMIT_RAW = Number(process.env.MEXC_MY_TRADES_LIMIT || 30);
const DEFAULT_RECV_WINDOW =
  Number.isFinite(DEFAULT_RECV_WINDOW_RAW) && DEFAULT_RECV_WINDOW_RAW > 0 ? DEFAULT_RECV_WINDOW_RAW : 5000;
const DEFAULT_TRADES_LIMIT =
  Number.isFinite(DEFAULT_TRADES_LIMIT_RAW) && DEFAULT_TRADES_LIMIT_RAW > 0 ? Math.min(DEFAULT_TRADES_LIMIT_RAW, 1000) : 30;
const MAX_BALANCES = 10;
const DEFAULT_REPORT_LIMIT = 25;
const MAX_REPORT_LIMIT = 100;

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

function compactParams(input) {
  const params = new URLSearchParams();
  Object.entries(input || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });
  return params;
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

export async function getMexcSpotSnapshot({
  workspaceId,
  integrationId,
  symbol,
  orderId,
  origClientOrderId
}) {
  const integration = await findMexcIntegration(workspaceId, integrationId);
  const credentials = {
    apiKey: decrypt(integration.credential.apiKey),
    apiSecret: decrypt(integration.credential.apiSecret)
  };

  const normalizedSymbol = normalizeSymbol(symbol);
  const orderQuery = {
    symbol: normalizedSymbol,
    orderId: orderId ? String(orderId) : undefined,
    origClientOrderId: origClientOrderId ? String(origClientOrderId) : undefined
  };

  const accountPromise = mexcSignedGet(credentials, '/api/v3/account');
  const openOrdersPromise = normalizedSymbol
    ? mexcSignedGet(credentials, '/api/v3/openOrders', { symbol: normalizedSymbol })
    : Promise.resolve([]);
  const tradesPromise = normalizedSymbol
    ? mexcSignedGet(credentials, '/api/v3/myTrades', { symbol: normalizedSymbol, limit: DEFAULT_TRADES_LIMIT })
    : Promise.resolve([]);
  const orderPromise =
    normalizedSymbol && (orderQuery.orderId || orderQuery.origClientOrderId)
      ? mexcSignedGet(credentials, '/api/v3/order', {
          symbol: normalizedSymbol,
          ...extractOrderParams(orderQuery)
        })
      : Promise.resolve(null);

  const [accountResult, openOrdersResult, tradesResult, orderResult] = await Promise.allSettled([
    accountPromise,
    openOrdersPromise,
    tradesPromise,
    orderPromise
  ]);

  const accountOk = accountResult.status === 'fulfilled';
  const openOrdersOk = openOrdersResult.status === 'fulfilled';
  const tradesOk = tradesResult.status === 'fulfilled';
  const orderOk = orderResult.status === 'fulfilled';

  const balances = accountOk ? mapBalances(accountResult.value) : null;
  const openOrders = openOrdersOk ? summarizeOpenOrders(openOrdersResult.value, orderQuery) : null;
  const trades = tradesOk ? summarizeTrades(tradesResult.value) : null;
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
      origClientOrderId: orderQuery.origClientOrderId || null
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
  if (normalized === 'executed_success' || normalized === 'succeeded') return 'executed';
  if (normalized === 'executed_error' || normalized === 'failed') return 'failed';
  if (normalized === 'retrying') return 'retrying';
  if (normalized === 'ready_for_execution' || normalized === 'queued') return 'queued';
  if (normalized === 'skipped_no_rule') return 'skipped';
  return normalized || 'unknown';
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

function mapReportRow(signal, alert, integrationMeta, matchType) {
  const symbol = alert?.symbol || signal?.symbol || signal?.payload?.symbol || signal?.payload?.raw?.symbol || null;
  const side = alert?.side || signal?.side || signal?.payload?.side || signal?.payload?.raw?.side || null;
  const signalTimestamp =
    toIso(alert?.receivedAt) ||
    toIso(signal?.payload?.timestamp || signal?.payload?.raw?.timestamp) ||
    toIso(signal?.createdAt);

  return {
    key: signal.id,
    matchType,
    signal: {
      id: alert?.id || extractAlertId(signal) || signal.id,
      sourceId: extractSourceId(signal, alert),
      timestamp: signalTimestamp,
      symbol,
      side
    },
    exchange: {
      integrationId: signal.integrationId || null,
      integrationLabel: integrationMeta?.label || integrationMeta?.exchange || 'Integration',
      exchange: integrationMeta?.exchange || null,
      tradeStatus: mapTradeStatus(signal.status),
      executionTimestamp: toIso(signal.executedAt) || toIso(signal.createdAt),
      side: signal.side || side || null,
      type: signal.type || signal?.payload?.type || signal?.payload?.raw?.type || null,
      amount: signal.amount ?? null,
      quantity: resolveQuantity(signal),
      orderId:
        signal?.payload?.executionResult?.orderId ||
        signal?.payload?.executionResult?.id ||
        signal?.payload?.executionResult?.clientOrderId ||
        null,
      errorMessage: signal.error || null
    }
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
  const items = signals.map((signal) => {
    const alertId = extractAlertId(signal);
    if (alertId && alertsById[alertId]) {
      return mapReportRow(signal, alertsById[alertId], integrationMap[signal.integrationId], 'alert_id');
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
      return mapReportRow(signal, bestAlert, integrationMap[signal.integrationId], 'heuristic');
    }

    return mapReportRow(signal, null, integrationMap[signal.integrationId], 'unmatched');
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    total: items.length,
    items
  };
}
