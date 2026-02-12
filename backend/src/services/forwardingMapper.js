import crypto from 'crypto';

// Normalize TradingView-like payloads into a generic order request
export function normalizePayload(raw = {}) {
  const p = typeof raw === 'object' && raw ? raw : {};
  const parsedMessage =
    typeof p.message === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(p.message);
            return parsed && typeof parsed === 'object' ? parsed : null;
          } catch {
            return null;
          }
        })()
      : null;
  const source = parsedMessage ? { ...p, ...parsedMessage } : p;
  const symbol = source.symbol || source.ticker || source.pair || source.market || null;
  let side = String(source.side || source.action || source.direction || '').toLowerCase();
  if (side === 'buy' || side === 'long') side = 'buy';
  else if (side === 'sell' || side === 'short') side = 'sell';
  else side = null;
  const type = (source.type || source.orderType || (source.price ? 'limit' : 'market'))?.toLowerCase();
  const amount = Number(source.amount ?? source.qty ?? source.quantity ?? source.size ?? NaN);
  const price = source.price !== undefined ? Number(source.price) : undefined;
  const clientOrderId = source.clientOrderId || source.client_id || source.order_id || source.id || null;
  const exchange = source.exchange || source.venue || null;
  const environment = source.environment || source.env || null;
  const ts = source.ts ?? source.timestamp ?? source.timenow ?? null;

  return {
    symbol: symbol || undefined,
    side: side || undefined,
    type: type || undefined,
    amount: Number.isFinite(amount) ? amount : undefined,
    price: Number.isFinite(price) ? price : undefined,
    clientOrderId: clientOrderId || undefined,
    exchange: exchange || undefined,
    environment: environment || undefined,
    ts: ts || undefined,
    raw: source
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
    ts: normalized.ts || normalized.raw?.timestamp || normalized.raw?.ts || null
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
