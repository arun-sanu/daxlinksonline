import express from 'express';

function asText(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (raw?.type === 'Buffer' && Array.isArray(raw.data)) {
    return Buffer.from(raw.data).toString('utf8');
  }
  return String(raw);
}

function tryParseJson(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function parseTradingviewBodyText(rawBody) {
  const text = asText(rawBody);
  const parsed = tryParseJson(text);
  if (parsed && typeof parsed === 'object') {
    return { payload: parsed, rawBodyText: text };
  }
  if (parsed !== null) {
    return { payload: { message: parsed }, rawBodyText: text };
  }
  return { payload: { message: text }, rawBodyText: text };
}

const rawBodyParser = express.raw({ type: '*/*', limit: '1mb' });

function decodeTradingviewPayload(req, _res, next) {
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  req.rawBody = buffer;
  if (!buffer.length) {
    req.body = {};
    req.rawBodyText = '';
    return next();
  }
  const { payload, rawBodyText } = parseTradingviewBodyText(buffer);
  req.body = payload;
  req.rawBodyText = rawBodyText;
  next();
}

export const tradingviewBodyMiddleware = [rawBodyParser, decodeTradingviewPayload];
