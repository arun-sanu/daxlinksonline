import crypto from 'crypto';

const DEFAULT_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const DEFAULT_RECV_WINDOW = Number(process.env.MEXC_RECV_WINDOW || 5000);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRecvWindow(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5000;
  return Math.floor(parsed);
}

function compactParams(input = {}) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  return params;
}

function toSafeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function redactRequest(params) {
  const output = {};
  Object.entries(params || {}).forEach(([key, value]) => {
    if (key.toLowerCase().includes('signature')) return;
    output[key] = value;
  });
  return output;
}

function normalizeSide(side) {
  const normalized = String(side || '').trim().toUpperCase();
  if (normalized === 'BUY' || normalized === 'SELL') return normalized;
  return null;
}

function toFixedString(value, maxDecimals = 12) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const asFixed = numeric.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return asFixed || '0';
}

export function extractSymbolFilters(exchangeInfoPayload, symbol) {
  const symbols = Array.isArray(exchangeInfoPayload?.symbols) ? exchangeInfoPayload.symbols : [];
  const symbolInfo = symbols.find((row) => String(row?.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()) || symbols[0] || null;
  const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : [];
  const lotSize = filters.find((f) => f.filterType === 'LOT_SIZE') || {};
  const minNotionalFilter = filters.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') || {};
  const basePrecision = asNumber(symbolInfo?.baseSizePrecision);
  const stepSize = basePrecision && basePrecision > 0
    ? basePrecision
    : asNumber(lotSize.stepSize) || 0;
  return {
    symbol: symbolInfo?.symbol || String(symbol || '').toUpperCase(),
    baseAsset: symbolInfo?.baseAsset || null,
    quoteAsset: symbolInfo?.quoteAsset || null,
    stepSize,
    minQty: asNumber(lotSize.minQty) || 0,
    minNotional: asNumber(minNotionalFilter.minNotional) || 0
  };
}

export function createMexcSpotClient({
  apiKey,
  apiSecret,
  baseUrl = DEFAULT_BASE_URL,
  recvWindow = DEFAULT_RECV_WINDOW,
  logger = console
}) {
  if (!apiKey || !apiSecret) {
    throw new Error('MEXC API credentials are required');
  }

  const normalizedRecvWindow = normalizeRecvWindow(recvWindow);

  async function parseResponse(res) {
    const text = await res.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const message = payload?.msg || payload?.message || text || `MEXC request failed (${res.status})`;
      throw Object.assign(new Error(message), { status: res.status, payload });
    }
    if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
      const message = payload.msg || payload.message || `MEXC request failed with code ${payload.code}`;
      throw Object.assign(new Error(message), { status: 502, payload });
    }
    return payload;
  }

  async function signedRequest(method, path, params = {}) {
    const baseParams = {
      ...params,
      recvWindow: normalizedRecvWindow,
      timestamp: Date.now()
    };
    const query = compactParams(baseParams);
    const signature = crypto.createHmac('sha256', apiSecret).update(query.toString()).digest('hex');
    query.set('signature', signature);
    const url = `${baseUrl}${path}?${query.toString()}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-MEXC-APIKEY': apiKey
      }
    });
    return parseResponse(res);
  }

  async function publicRequest(path, params = {}) {
    const query = compactParams(params);
    const queryString = query.toString();
    const url = queryString ? `${baseUrl}${path}?${queryString}` : `${baseUrl}${path}`;
    const res = await fetch(url, { method: 'GET' });
    return parseResponse(res);
  }

  return {
    async getAccount() {
      return signedRequest('GET', '/api/v3/account');
    },

    async getTickerPrice(symbol) {
      const payload = await publicRequest('/api/v3/ticker/price', { symbol: String(symbol || '').toUpperCase() });
      const price = asNumber(payload?.price);
      if (!price || price <= 0) {
        throw new Error('Failed to resolve ticker price for symbol');
      }
      return {
        symbol: payload?.symbol || String(symbol || '').toUpperCase(),
        price
      };
    },

    async getExchangeInfo(symbol) {
      return publicRequest('/api/v3/exchangeInfo', { symbol: String(symbol || '').toUpperCase() });
    },

    async getSymbolFilters(symbol) {
      const info = await publicRequest('/api/v3/exchangeInfo', { symbol: String(symbol || '').toUpperCase() });
      return extractSymbolFilters(info, symbol);
    },

    async placeMarketOrderBaseQty({ symbol, side, quantity, newClientOrderId }) {
      const normalizedSymbol = String(symbol || '').toUpperCase();
      const normalizedSide = normalizeSide(side);
      const qty = toFixedString(quantity, 12);
      if (!normalizedSymbol) throw new Error('symbol is required for MEXC order');
      if (!normalizedSide) throw new Error('side must be BUY or SELL');
      if (!qty || Number(qty) <= 0) throw new Error('quantity must be > 0');

      const requestParams = {
        symbol: normalizedSymbol,
        side: normalizedSide,
        type: 'MARKET',
        quantity: qty
      };
      if (newClientOrderId) {
        requestParams.newClientOrderId = String(newClientOrderId).slice(0, 32);
      }

      logger.info?.('[mexc] placing spot market order', redactRequest(requestParams));
      const payload = await signedRequest('POST', '/api/v3/order', requestParams);
      logger.info?.(
        '[mexc] order response',
        toSafeJson({
          symbol: payload?.symbol || normalizedSymbol,
          orderId: payload?.orderId || payload?.id || null,
          status: payload?.status || null,
          executedQty: payload?.executedQty || null
        })
      );
      return payload;
    },

    async getOrder({ symbol, orderId, origClientOrderId }) {
      const params = { symbol: String(symbol || '').toUpperCase() };
      if (orderId) params.orderId = orderId;
      if (origClientOrderId) params.origClientOrderId = origClientOrderId;
      return signedRequest('GET', '/api/v3/order', params);
    }
  };
}
