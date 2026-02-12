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

function captureRawBody(req, _res, buf) {
  req.rawBody = Buffer.from(buf);
  req.rawBodyText = req.rawBody.toString('utf8');
}

const jsonBodyParser = express.json({
  type: ['application/json', 'application/*+json'],
  limit: '1mb',
  verify: captureRawBody
});

const textBodyParser = express.text({
  type: ['text/plain', 'text/*'],
  limit: '1mb',
  verify: captureRawBody
});

function decodeTradingviewPayload(req, _res, next) {
  if (typeof req.body === 'string') {
    if (!Buffer.isBuffer(req.rawBody)) {
      req.rawBody = Buffer.from(req.body, 'utf8');
    }
    req.rawBodyText = req.body;
    return next();
  }

  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    if (!Buffer.isBuffer(req.rawBody)) {
      const raw = JSON.stringify(req.body);
      req.rawBody = Buffer.from(raw, 'utf8');
      req.rawBodyText = raw;
    } else if (typeof req.rawBodyText !== 'string') {
      req.rawBodyText = req.rawBody.toString('utf8');
    }
    return next();
  }

  const buffer = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.alloc(0);
  req.rawBody = buffer;
  if (!buffer.length && !req.body) {
    req.body = {};
    req.rawBodyText = typeof req.rawBodyText === 'string' ? req.rawBodyText : '';
    return next();
  }
  const { payload, rawBodyText } = parseTradingviewBodyText(buffer);
  req.body = payload;
  req.rawBodyText = rawBodyText;
  next();
}

export const tradingviewBodyMiddleware = [jsonBodyParser, textBodyParser, decodeTradingviewPayload];
