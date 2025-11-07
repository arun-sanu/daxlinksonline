// Minimal in-memory token bucket rate limiter per key (subdomain)

export function perSubdomainRateLimit({ maxPerSecond = 20 } = {}) {
  const buckets = new Map(); // key -> { tokens, last }

  function take(key) {
    const now = Date.now();
    const bucket = buckets.get(key) || { tokens: maxPerSecond, last: now };
    const elapsed = (now - bucket.last) / 1000;
    const refill = Math.floor(elapsed * maxPerSecond);
    if (refill > 0) {
      bucket.tokens = Math.min(maxPerSecond, bucket.tokens + refill);
      bucket.last = now;
    }
    if (bucket.tokens > 0) {
      bucket.tokens -= 1;
      buckets.set(key, bucket);
      return true;
    }
    buckets.set(key, bucket);
    return false;
  }

  return (req, res, next) => {
    const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().toLowerCase();
    const key = `rate:${host}`;
    if (take(key)) return next();
    res.status(429).json({ error: 'Rate limit exceeded' });
  };
}
