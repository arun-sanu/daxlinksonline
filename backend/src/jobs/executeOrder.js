import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import crypto from 'crypto';

const isDryRun = process.env.WORKFLOW_EXECUTION_MODE === 'dryrun';
const MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');
const MEXC_RECV_WINDOW = Number(process.env.MEXC_RECV_WINDOW || 5000);

function normalizeRecvWindow(value) {
  if (!Number.isFinite(value) || value <= 0) return 5000;
  return Math.floor(value);
}

const SAFE_MEXC_RECV_WINDOW = normalizeRecvWindow(MEXC_RECV_WINDOW);

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
  const side = String(value || '').toLowerCase();
  if (side === 'buy' || side === 'long') return 'BUY';
  if (side === 'sell' || side === 'short') return 'SELL';
  return null;
}

function normalizeOrderType(value) {
  const type = String(value || '').toLowerCase();
  if (!type) return 'MARKET';
  if (type === 'market') return 'MARKET';
  if (type === 'limit') return 'LIMIT';
  if (type === 'stop') return 'STOP';
  if (type === 'stop_limit' || type === 'stoplimit') return 'STOP';
  return type.toUpperCase();
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeAmountMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['quote', 'usdc', 'usdt', 'quote_amount', 'quoteamount'].includes(normalized)) return 'quote';
  if (['base', 'btc', 'quantity', 'qty'].includes(normalized)) return 'base';
  return null;
}

function toFixedString(value, maxDecimals = 12) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const asFixed = numeric.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return asFixed || '0';
}

function resolveOrderSize(mappedSize, fallbackAmount) {
  if (mappedSize !== undefined && mappedSize !== null) {
    if (typeof mappedSize === 'string') {
      const trimmed = mappedSize.trim();
      if (trimmed.endsWith('%')) {
        const fallback = parseNumeric(fallbackAmount);
        return fallback != null && fallback > 0 ? fallback : null;
      }
      const parsed = parseNumeric(trimmed);
      if (parsed != null && parsed > 0) return parsed;
    }
    const numeric = parseNumeric(mappedSize);
    if (numeric != null && numeric > 0) return numeric;
  }
  const fallback = parseNumeric(fallbackAmount);
  return fallback != null && fallback > 0 ? fallback : null;
}

async function placeOrderBestEffort(exchange, n) {
  const params = {
    symbol: n.symbol,
    side: n.side,
    type: n.type || (n.price ? 'LIMIT' : 'MARKET'),
    amount: n.amount || n.qty || 0,
    qty: n.qty || n.amount || 0,
    quantity: n.amount || n.qty || 0,
    quoteAmount: n.quoteAmount,
    quoteOrderQty: n.quoteAmount,
    price: n.price,
    clientOrderId: n.clientOrderId,
    exchange: n.exchange,
    environment: n.environment,
    raw: n.raw
  };
  if (!params.symbol || !params.side) {
    throw new Error('Missing symbol/side in alert payload');
  }
  if (typeof exchange.submitSignal === 'function') {
    return exchange.submitSignal(params);
  }
  if (typeof exchange.createOrder === 'function') {
    return exchange.createOrder(params);
  }
  if (typeof exchange.placeOrder === 'function') {
    return exchange.placeOrder(params);
  }
  if (typeof exchange.order === 'function') {
    return exchange.order(params);
  }
  if (typeof exchange.trade === 'function') {
    return exchange.trade(params);
  }
  throw new Error('Exchange adapter does not support order placement');
}

async function placeMexcSpotOrderDirect({
  apiKey,
  apiSecret,
  symbol,
  side,
  type,
  qty,
  price,
  clientOrderId
}) {
  const params = new URLSearchParams();
  params.set('symbol', symbol);
  params.set('side', side);
  params.set('type', type);
  const quantity = toFixedString(qty, 12);
  if (!quantity || Number(quantity) <= 0) {
    throw new Error('Invalid quantity for MEXC order');
  }
  params.set('quantity', quantity);
  params.set('recvWindow', String(SAFE_MEXC_RECV_WINDOW));
  params.set('timestamp', String(Date.now()));
  if (clientOrderId) {
    params.set('newClientOrderId', String(clientOrderId).slice(0, 32));
  }

  if (type === 'LIMIT') {
    const orderPrice = toFixedString(price, 12);
    if (!orderPrice || Number(orderPrice) <= 0) {
      throw new Error('Price required for MEXC LIMIT order');
    }
    params.set('price', orderPrice);
    params.set('timeInForce', 'GTC');
  }

  const signature = crypto.createHmac('sha256', apiSecret).update(params.toString()).digest('hex');
  params.set('signature', signature);

  const res = await fetch(`${MEXC_BASE_URL}/api/v3/order?${params.toString()}`, {
    method: 'POST',
    headers: {
      'X-MEXC-APIKEY': apiKey
    }
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const detail = payload?.msg || payload?.message || text || `MEXC order failed (${res.status})`;
    throw new Error(detail);
  }
  if (payload && typeof payload === 'object' && 'code' in payload && payload.code !== 0) {
    throw new Error(payload.msg || payload.message || `MEXC order failed with code ${payload.code}`);
  }
  return {
    provider: 'mexc-direct',
    amountMode: 'base',
    ...payload
  };
}

async function fetchMexcTickerPrice(symbol) {
  const res = await fetch(`${MEXC_BASE_URL}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
    method: 'GET'
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new Error(payload?.msg || payload?.message || text || `Failed to fetch ticker price (${res.status})`);
  }
  const price = parseNumeric(payload?.price);
  if (!price || price <= 0) {
    throw new Error('Invalid ticker price for quote conversion');
  }
  return price;
}

async function fetchMexcSymbolMeta(symbol) {
  const res = await fetch(`${MEXC_BASE_URL}/api/v3/exchangeInfo?symbol=${encodeURIComponent(symbol)}`, {
    method: 'GET'
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new Error(payload?.msg || payload?.message || text || `Failed to fetch exchange info (${res.status})`);
  }
  const symbolInfo = Array.isArray(payload?.symbols) ? payload.symbols[0] : null;
  const filters = Array.isArray(symbolInfo?.filters) ? symbolInfo.filters : [];
  const lotSize = filters.find((f) => f.filterType === 'LOT_SIZE') || {};
  const notionalFilter = filters.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') || {};
  const stepFromSymbol = parseNumeric(symbolInfo?.baseSizePrecision) || 0;
  return {
    minQty: parseNumeric(lotSize.minQty) || stepFromSymbol || 0,
    stepSize: parseNumeric(lotSize.stepSize) || stepFromSymbol || 0,
    minNotional: parseNumeric(notionalFilter.minNotional) || 0
  };
}

function floorToStep(value, step) {
  if (!step || step <= 0) return value;
  const precision = (() => {
    const s = String(step);
    if (!s.includes('.')) return 0;
    return s.split('.')[1].replace(/0+$/, '').length;
  })();
  const scale = Math.pow(10, precision);
  const scaledValue = Math.floor(value * scale + 1e-8);
  const scaledStep = Math.round(step * scale);
  if (!scaledStep || scaledStep <= 0) return value;
  const stepped = Math.floor(scaledValue / scaledStep) * scaledStep;
  return stepped / scale;
}

async function convertQuoteToBaseQty({ symbol, quoteAmount }) {
  const [price, meta] = await Promise.all([fetchMexcTickerPrice(symbol), fetchMexcSymbolMeta(symbol)]);
  if (meta.minNotional > 0 && quoteAmount < meta.minNotional) {
    throw new Error(`Amount too small: minimum notional is ${meta.minNotional}`);
  }
  let qty = quoteAmount / price;
  qty = floorToStep(qty, meta.stepSize);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Amount too small after quantity step rounding');
  }
  if (meta.minQty > 0 && qty < meta.minQty) {
    throw new Error(`Amount too small: minimum quantity is ${meta.minQty}`);
  }
  return qty;
}

function getAlertId(signal) {
  return signal?.payload?.raw?.alertId || signal?.payload?.alertId || null;
}

async function markAlertStatus(alertId, status, message = null) {
  if (!alertId) return;
  try {
    await updateTradingviewAlertStatus(alertId, status, message);
  } catch {
    // Never block execution on alert bookkeeping
  }
}

export async function executePreparedSignal(signalId) {
  if (!signalId) return null;
  const signal = await prisma.forwardedSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error('Signal not found');
  if (!['ready_for_execution', 'retrying'].includes(signal.status)) {
    return { skipped: true, reason: 'status_not_ready' };
  }

  if (!signal.integrationId) {
    await markAlertStatus(getAlertId(signal), 'failed', 'Missing integration for execution');
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'missing_integration', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'missing_integration' };
  }

  const integration = await prisma.integration.findUnique({
    where: { id: signal.integrationId },
    include: { credential: true }
  });
  if (!integration || !integration.credential) {
    await markAlertStatus(getAlertId(signal), 'failed', 'Integration credentials missing');
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'integration_credentials_missing', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'integration_credentials_missing' };
  }

  const mappedOrder = signal.payload?.mappedOrder || signal.payload?.raw?.mappedOrder || {};
  const { symbol: mappedSymbol, size, orderType, leverage } = mappedOrder;
  const symbol = mappedSymbol || signal.symbol || signal.payload?.raw?.symbol || null;
  const side = normalizeSide(signal.side || signal.payload?.raw?.side || mappedOrder.side);
  const orderTypeNorm = normalizeOrderType(orderType || signal.type || signal.payload?.raw?.type || 'market');
  const fallbackAmount =
    signal.amount ??
    signal.payload?.amount ??
    signal.payload?.raw?.amount ??
    signal.payload?.raw?.qty ??
    signal.payload?.raw?.quantity ??
    null;
  let qty = resolveOrderSize(size, fallbackAmount);
  const defaultAmountMode =
    orderTypeNorm === 'MARKET' && typeof symbol === 'string' && /(USDT|USDC)$/i.test(symbol) ? 'quote' : 'base';

  const amountMode =
    normalizeAmountMode(signal.payload?.amountMode) ||
    normalizeAmountMode(signal.payload?.amountCurrency) ||
    normalizeAmountMode(signal.payload?.raw?.amountMode) ||
    normalizeAmountMode(signal.payload?.raw?.amountCurrency) ||
    (signal.payload?.quoteAmount != null || signal.payload?.raw?.quoteAmount != null ? 'quote' : defaultAmountMode);

  let quoteAmount = parseNumeric(signal.payload?.quoteAmount ?? signal.payload?.raw?.quoteAmount);
  if (amountMode === 'quote' && (quoteAmount == null || quoteAmount <= 0)) {
    quoteAmount = parseNumeric(fallbackAmount);
  }

  const needsQuoteConversion = amountMode === 'quote';
  if (needsQuoteConversion && quoteAmount != null && quoteAmount > 0 && symbol) {
    qty = await convertQuoteToBaseQty({ symbol, quoteAmount });
  }

  const missingQty = qty === null || qty <= 0;
  const missingQuote = amountMode === 'quote' && (!quoteAmount || quoteAmount <= 0);
  if (!symbol || !side || (missingQty && !(amountMode === 'quote' && side === 'BUY' && orderTypeNorm === 'MARKET')) || missingQuote) {
    await markAlertStatus(getAlertId(signal), 'failed', 'Mapped order incomplete');
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: { status: 'executed_error', error: 'mapped_order_incomplete', attempts: { increment: 1 } }
    });
    return { skipped: true, reason: 'mapped_order_incomplete' };
  }

  try {
    if (isDryRun) {
      await markAlertStatus(getAlertId(signal), 'executed', 'Dry-run execution');
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult: { dryRun: true } },
          executedAt: new Date()
        }
      });
      return { ok: true, dryRun: true };
    }

    const apiKey = decryptRequired(integration.credential.apiKey, 'API key');
    const apiSecret = decryptRequired(integration.credential.apiSecret, 'API secret');
    const passphrase = decryptOptional(integration.credential.passphrase);

    const client = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey,
      apiSecret,
      passphrase
    });

    const price = parseNumeric(mappedOrder.price ?? signal.price ?? signal.payload?.raw?.price);
    const clientOrderId =
      signal.payload?.raw?.clientOrderId ||
      signal.payload?.raw?.client_id ||
      signal.payload?.raw?.order_id ||
      signal.payload?.raw?.id ||
      signal.idempotencyKey ||
      null;

    const isMexc = String(integration.exchange || '').toLowerCase() === 'mexc';
    let result;
    if (isMexc) {
      result = await placeMexcSpotOrderDirect({
        apiKey,
        apiSecret,
        symbol,
        side,
        type: orderTypeNorm,
        qty,
        price,
        clientOrderId
      });
    } else {
      result = await placeOrderBestEffort(client, {
        symbol,
        side,
        type: orderTypeNorm,
        amount: qty,
        qty,
        quoteAmount: amountMode === 'quote' ? quoteAmount : null,
        price,
        clientOrderId,
        exchange: integration.exchange,
        environment: integration.environment,
        raw: {
          ...(signal.payload || {}),
          leverage: leverage || signal.payload?.raw?.leverage || undefined
        }
      });
    }
    await markAlertStatus(getAlertId(signal), 'executed', null);
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: 'executed_success',
        payload: { ...(signal.payload || {}), executionResult: result },
        executedAt: new Date()
      }
    });
    return { ok: true, result };
  } catch (err) {
    const attempts = (signal.attempts || 0) + 1;
    await markAlertStatus(getAlertId(signal), 'failed', err?.message || String(err));
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: 'executed_error',
        error: err?.message || String(err),
        attempts
      }
    });
    return { ok: false, error: err?.message || String(err), retry: false };
  }
}
