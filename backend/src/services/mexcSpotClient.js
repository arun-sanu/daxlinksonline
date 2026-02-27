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

function normalizeLimitOrderType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'LIMIT') return 'LIMIT';
  if (normalized === 'LIMIT_MAKER') return 'LIMIT_MAKER';
  return null;
}

function normalizePrecisionDigits(value) {
  const parsed = asNumber(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function precisionStep(digits) {
  if (!Number.isFinite(digits) || digits < 0) return 0;
  return 10 ** (-digits);
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

function roundDownToStep(value, step) {
  const num = asNumber(value);
  const stepNum = asNumber(step);
  if (!num || num <= 0) return 0;
  if (!stepNum || stepNum <= 0) return num;
  const decimals = Math.max(0, Math.min(stepDecimals(stepNum), 12));
  const scale = 10 ** decimals;
  const stepScaled = Math.round(stepNum * scale);
  if (!stepScaled || stepScaled <= 0) return Number(num.toFixed(decimals));
  const valueScaled = num * scale;
  const flooredScaled = Math.floor((valueScaled + 1e-6) / stepScaled) * stepScaled;
  return Number((flooredScaled / scale).toFixed(decimals));
}

function roundToPrecision(value, digits, mode = 'floor') {
  const num = asNumber(value);
  const precisionDigits = normalizePrecisionDigits(digits);
  if (!num || num <= 0) return 0;
  if (precisionDigits === null) return num;
  const scale = 10 ** precisionDigits;
  if (!Number.isFinite(scale) || scale <= 0) return num;
  if (mode === 'ceil') {
    return Math.ceil((num - 1e-12) * scale) / scale;
  }
  return Math.floor((num + 1e-12) * scale) / scale;
}

function toFixedString(value, maxDecimals = 12) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const asFixed = numeric.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return asFixed || '0';
}

function normalizeQuantityForOrder(quantity, filters = null) {
  const qtyNum = asNumber(quantity);
  if (!qtyNum || qtyNum <= 0) return null;
  const qtyStep = asNumber(filters?.stepSize) || 0;
  const qtyPrecision = normalizePrecisionDigits(filters?.quantityPrecision ?? filters?.baseAssetPrecision);
  let normalized = qtyNum;
  if (qtyStep > 0) normalized = roundDownToStep(normalized, qtyStep);
  normalized = roundToPrecision(normalized, qtyPrecision, 'floor');
  if (qtyStep > 0) normalized = roundDownToStep(normalized, qtyStep);
  if (!normalized || normalized <= 0) return null;
  const stepDigits = qtyStep > 0 ? stepDecimals(qtyStep) : 12;
  const maxDecimals = Math.max(0, Math.min(12, qtyPrecision === null ? stepDigits : Math.min(stepDigits, qtyPrecision)));
  return toFixedString(normalized, maxDecimals);
}

function normalizePriceForOrder(price, filters = null, side = null) {
  const priceNum = asNumber(price);
  if (!priceNum || priceNum <= 0) return null;
  const normalizedSide = normalizeSide(side) || 'BUY';
  const priceStep = asNumber(filters?.tickSize) || 0;
  const pricePrecision = normalizePrecisionDigits(filters?.pricePrecision ?? filters?.quotePrecision);
  const roundingMode = normalizedSide === 'SELL' ? 'ceil' : 'floor';
  let normalized = priceNum;
  if (priceStep > 0) {
    normalized = roundingMode === 'ceil'
      ? roundToPrecision(Math.ceil((normalized - 1e-12) / priceStep) * priceStep, 12, 'ceil')
      : roundDownToStep(normalized, priceStep);
  }
  normalized = roundToPrecision(normalized, pricePrecision, roundingMode);
  if (priceStep > 0) {
    normalized = roundingMode === 'ceil'
      ? roundToPrecision(Math.ceil((normalized - 1e-12) / priceStep) * priceStep, 12, 'ceil')
      : roundDownToStep(normalized, priceStep);
  }
  if (!normalized || normalized <= 0) return null;
  const stepDigits = priceStep > 0 ? stepDecimals(priceStep) : 12;
  const maxDecimals = Math.max(0, Math.min(12, pricePrecision === null ? stepDigits : Math.min(stepDigits, pricePrecision)));
  return toFixedString(normalized, maxDecimals);
}

export function extractSymbolFilters(exchangeInfoPayload, symbol) {
  const symbols = Array.isArray(exchangeInfoPayload?.symbols) ? exchangeInfoPayload.symbols : [];
  const symbolInfo = symbols.find((row) => String(row?.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()) || symbols[0] || null;
  const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : [];
  const lotSize = filters.find((f) => f.filterType === 'LOT_SIZE') || {};
  const priceFilter = filters.find((f) => f.filterType === 'PRICE_FILTER') || {};
  const minNotionalFilter = filters.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') || {};
  // Some MEXC symbols omit MIN_NOTIONAL/NOTIONAL but still enforce a quote-side minimum
  // (e.g. "The minimum transaction volume cannot be less than：1USDC").
  // In those cases, quoteAmountPrecisionMarket behaves as the effective min quote notional.
  const marketQuoteFloor =
    asNumber(symbolInfo?.quoteAmountPrecisionMarket) ||
    asNumber(symbolInfo?.quoteAmountPrecision) ||
    asNumber(symbolInfo?.minQuoteAmount) ||
    0;
  const baseSizePrecision = asNumber(symbolInfo?.baseSizePrecision);
  const baseAssetPrecision = normalizePrecisionDigits(symbolInfo?.baseAssetPrecision);
  const quotePrecision = normalizePrecisionDigits(symbolInfo?.quotePrecision);
  const precisionStepSize = precisionStep(baseAssetPrecision);
  const rawStepSize = baseSizePrecision && baseSizePrecision > 0
    ? baseSizePrecision
    : asNumber(lotSize.stepSize) || 0;
  const stepSize = rawStepSize > 0
    ? (precisionStepSize > 0 ? Math.max(rawStepSize, precisionStepSize) : rawStepSize)
    : precisionStepSize;
  const rawTickSize = asNumber(priceFilter.tickSize) || 0;
  const precisionTickSize = precisionStep(quotePrecision);
  const tickSize = rawTickSize > 0
    ? (precisionTickSize > 0 ? Math.max(rawTickSize, precisionTickSize) : rawTickSize)
    : precisionTickSize;
  const minNotional =
    asNumber(minNotionalFilter.minNotional) ||
    asNumber(minNotionalFilter.notional) ||
    marketQuoteFloor ||
    0;
  return {
    symbol: symbolInfo?.symbol || String(symbol || '').toUpperCase(),
    baseAsset: symbolInfo?.baseAsset || null,
    quoteAsset: symbolInfo?.quoteAsset || null,
    orderTypes: Array.isArray(symbolInfo?.orderTypes) ? symbolInfo.orderTypes : [],
    baseAssetPrecision,
    quotePrecision,
    quantityPrecision: baseAssetPrecision,
    pricePrecision: quotePrecision,
    stepSize,
    tickSize,
    minQty: asNumber(lotSize.minQty) || 0,
    minNotional
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

    async getBookTicker(symbol) {
      const payload = await publicRequest('/api/v3/ticker/bookTicker', { symbol: String(symbol || '').toUpperCase() });
      const bid = asNumber(payload?.bidPrice);
      const ask = asNumber(payload?.askPrice);
      const mid = bid && ask ? (bid + ask) / 2 : null;
      return {
        symbol: payload?.symbol || String(symbol || '').toUpperCase(),
        bid: bid || null,
        ask: ask || null,
        mid,
        mark: mid
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
      const filters = await this.getSymbolFilters(normalizedSymbol).catch(() => null);
      const qty = normalizeQuantityForOrder(quantity, filters);
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

    async placeLimitOrderBaseQty({ symbol, side, quantity, price, orderType = 'LIMIT', newClientOrderId }) {
      const normalizedSymbol = String(symbol || '').toUpperCase();
      const normalizedSide = normalizeSide(side);
      const normalizedType = normalizeLimitOrderType(orderType);
      const filters = await this.getSymbolFilters(normalizedSymbol).catch(() => null);
      const qty = normalizeQuantityForOrder(quantity, filters);
      const limitPrice = normalizePriceForOrder(price, filters, normalizedSide);
      if (!normalizedSymbol) throw new Error('symbol is required for MEXC order');
      if (!normalizedSide) throw new Error('side must be BUY or SELL');
      if (!normalizedType) throw new Error('orderType must be LIMIT or LIMIT_MAKER');
      if (!qty || Number(qty) <= 0) throw new Error('quantity must be > 0');
      if (!limitPrice || Number(limitPrice) <= 0) throw new Error('price must be > 0 for limit order');

      const requestParams = {
        symbol: normalizedSymbol,
        side: normalizedSide,
        type: normalizedType,
        quantity: qty,
        price: limitPrice
      };
      if (normalizedType === 'LIMIT') {
        requestParams.timeInForce = 'GTC';
      }
      if (newClientOrderId) {
        requestParams.newClientOrderId = String(newClientOrderId).slice(0, 32);
      }

      logger.info?.(`[mexc] placing spot ${normalizedType.toLowerCase()} order`, redactRequest(requestParams));
      const payload = await signedRequest('POST', '/api/v3/order', requestParams);
      logger.info?.(
        '[mexc] order response',
        toSafeJson({
          symbol: payload?.symbol || normalizedSymbol,
          orderId: payload?.orderId || payload?.id || null,
          status: payload?.status || null,
          executedQty: payload?.executedQty || null,
          type: normalizedType
        })
      );
      return payload;
    },

    async getOrder({ symbol, orderId, origClientOrderId }) {
      const params = { symbol: String(symbol || '').toUpperCase() };
      if (orderId) params.orderId = orderId;
      if (origClientOrderId) params.origClientOrderId = origClientOrderId;
      return signedRequest('GET', '/api/v3/order', params);
    },

    async getOpenOrders(symbol) {
      const normalizedSymbol = String(symbol || '').toUpperCase();
      const params = normalizedSymbol ? { symbol: normalizedSymbol } : {};
      const payload = await signedRequest('GET', '/api/v3/openOrders', params);
      return Array.isArray(payload) ? payload : [];
    },

    async cancelOrder({ symbol, orderId, origClientOrderId }) {
      const normalizedSymbol = String(symbol || '').toUpperCase();
      if (!normalizedSymbol) throw new Error('symbol is required for cancelOrder');
      if (!orderId && !origClientOrderId) {
        throw new Error('orderId or origClientOrderId is required for cancelOrder');
      }
      const params = { symbol: normalizedSymbol };
      if (orderId) params.orderId = String(orderId);
      if (origClientOrderId) params.origClientOrderId = String(origClientOrderId);
      logger.info?.('[mexc] canceling spot order', redactRequest(params));
      return signedRequest('DELETE', '/api/v3/order', params);
    }
  };
}
