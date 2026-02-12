function trimToNull(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str : null;
}

function normalizeSymbol(value) {
  const symbol = trimToNull(value);
  if (!symbol) return null;
  const normalized = symbol.toUpperCase();
  return /^[A-Z0-9_-]{4,20}$/.test(normalized) ? normalized : null;
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';
  return null;
}

function parseTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return asNumber < 1e12 ? Math.floor(asNumber * 1000) : Math.floor(asNumber);
  }
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) return parsed;
  return null;
}

function parseJsonIfObject(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mergeMessagePayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return {};
  const messageObject =
    parseJsonIfObject(payload.message) ||
    parseJsonIfObject(payload.text) ||
    parseJsonIfObject(payload.signal) ||
    null;
  if (!messageObject) return payload;
  return {
    ...payload,
    ...messageObject
  };
}

export function normalizeTradingviewSignal(inputPayload = {}) {
  const base = mergeMessagePayload(inputPayload);
  const symbol =
    normalizeSymbol(base.symbol) ||
    normalizeSymbol(base.ticker) ||
    normalizeSymbol(base.pair) ||
    normalizeSymbol(base.market);
  const side = normalizeSide(base.side || base.action || base.direction);
  const ts = parseTimestampMs(base.ts ?? base.timestamp ?? base.timenow ?? base.time);

  const errors = [];
  if (!symbol) errors.push('symbol is required and must look like BTCUSDC');
  if (!side) errors.push('side is required and must be BUY or SELL');
  if (!ts) errors.push('ts is required and must be epoch milliseconds');

  const normalizedPayload = {
    ...base,
    symbol: symbol || base.symbol,
    side: side || base.side,
    ts: ts || base.ts
  };

  if (errors.length) {
    return {
      ok: false,
      errors,
      normalizedPayload
    };
  }

  return {
    ok: true,
    signal: {
      symbol,
      side,
      ts
    },
    normalizedPayload
  };
}

export function extractStrategyName(payload = {}) {
  const merged = mergeMessagePayload(payload);
  return (
    trimToNull(merged.strategy) ||
    trimToNull(merged.strategyName) ||
    trimToNull(merged.strategy_name) ||
    trimToNull(merged.name)
  );
}

export function normalizeSignalTimestamp(value) {
  return parseTimestampMs(value);
}
