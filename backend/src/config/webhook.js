const DEFAULT_SKEW_MS = 5 * 60 * 1000;

function parseNumber(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const webhookConfig = {
  maxSkewMs: parseNumber(process.env.WEBHOOK_MAX_SKEW_MS, DEFAULT_SKEW_MS),
  enforceHmacGlobally: process.env.ENFORCE_WEBHOOK_HMAC === 'true'
};
