import crypto from 'crypto';

export function parseSignatureHeader(req) {
  const header = req.headers['x-signature'] || req.headers['x-daxlinks-signature'];
  if (!header || typeof header !== 'string') return null;
  const parts = header.split(',').map((segment) => segment.trim());
  const map = {};
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value) map[key] = value;
  }
  return { raw: header, timestamp: map.t ? Number(map.t) : undefined, hash: map.v1 };
}

export function verifySignaturePayload(body, secret, timestamp) {
  const bodyJson = typeof body === 'string' ? body : JSON.stringify(body || {});
  const payload = timestamp ? `${bodyJson}.${timestamp}` : bodyJson;
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('hex');
}

export function verifyRequestSignature(req, secret, maxSkewMs = 5 * 60 * 1000) {
  const parsed = parseSignatureHeader(req);
  if (!parsed) return { provided: false, valid: false };
  const { timestamp, hash } = parsed;
  if (!timestamp || !hash) {
    return { provided: true, valid: false };
  }
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) {
    return { provided: true, valid: false, reason: 'stale' };
  }
  try {
    const expected = verifySignaturePayload(req.body || {}, secret, timestamp);
    const valid = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
    return { provided: true, valid };
  } catch (err) {
    return { provided: true, valid: false, reason: err.message };
  }
}
