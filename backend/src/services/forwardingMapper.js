import crypto from 'crypto';

// Normalize TradingView-like payloads into a generic order request
export function normalizePayload(raw = {}) {
  const p = typeof raw === 'object' && raw ? raw : {};
  const symbol = p.symbol || p.ticker || p.pair || p.market || null;
  let side = String(p.side || p.action || p.direction || '').toLowerCase();
  if (side === 'buy' || side === 'long') side = 'buy';
  else if (side === 'sell' || side === 'short') side = 'sell';
  else side = null;
  const type = (p.type || p.orderType || (p.price ? 'limit' : 'market'))?.toLowerCase();
  const amount = Number(p.amount ?? p.qty ?? p.quantity ?? p.size ?? NaN);
  const price = p.price !== undefined ? Number(p.price) : undefined;
  const clientOrderId = p.clientOrderId || p.client_id || p.order_id || p.id || null;
  const exchange = p.exchange || p.venue || null;
  const environment = p.environment || p.env || null;

  return {
    symbol: symbol || undefined,
    side: side || undefined,
    type: type || undefined,
    amount: Number.isFinite(amount) ? amount : undefined,
    price: Number.isFinite(price) ? price : undefined,
    clientOrderId: clientOrderId || undefined,
    exchange: exchange || undefined,
    environment: environment || undefined,
    raw: p
  };
}

export function computeIdempotencyKey({ userId, normalized }) {
  const base = {
    uid: userId,
    symbol: normalized.symbol || null,
    side: normalized.side || null,
    type: normalized.type || null,
    amount: normalized.amount || null,
    price: normalized.price || null,
    clientOrderId: normalized.clientOrderId || null,
    ts: normalized.raw?.timestamp || normalized.raw?.ts || null
  };
  const input = JSON.stringify(base);
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sanitizePayload(obj) {
  try {
    const copy = typeof obj === 'object' && obj !== null ? JSON.parse(JSON.stringify(obj)) : obj;
    if (copy && typeof copy === 'object') {
      if (Object.prototype.hasOwnProperty.call(copy, 'secret')) copy.secret = '[redacted]';
      if (Object.prototype.hasOwnProperty.call(copy, 'apiKey')) copy.apiKey = '[redacted]';
      if (Object.prototype.hasOwnProperty.call(copy, 'apiSecret')) copy.apiSecret = '[redacted]';
    }
    return copy;
  } catch {
    return {};
  }
}

