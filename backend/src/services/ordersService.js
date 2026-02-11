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

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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
