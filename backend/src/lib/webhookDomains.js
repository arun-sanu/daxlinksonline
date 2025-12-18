const FALLBACK_DOMAIN = 'daxlinksonline.link';
let cachedBaseDomain = null;

function normalizeDomain(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

export function getWebhookBaseDomain() {
  if (cachedBaseDomain) {
    return cachedBaseDomain;
  }
  const fromEnv = normalizeDomain(process.env.WEBHOOK_BASE_DOMAIN || FALLBACK_DOMAIN);
  cachedBaseDomain = fromEnv || FALLBACK_DOMAIN;
  return cachedBaseDomain;
}

export function extractSubdomain(hostname, baseDomain = getWebhookBaseDomain()) {
  const host = String(hostname || '').toLowerCase().split(':')[0];
  if (!host || !baseDomain) return null;
  if (!host.endsWith(baseDomain)) return null;
  const hostParts = host.split('.');
  const baseParts = baseDomain.split('.');
  if (hostParts.length <= baseParts.length) return null;
  return hostParts.slice(0, hostParts.length - baseParts.length).join('.');
}

export function buildWebhookHostname(prefix, baseDomain = getWebhookBaseDomain()) {
  if (!prefix) return baseDomain;
  return `${prefix}.${baseDomain}`;
}

export function buildTradingviewWebhookUrl(prefix, secret, baseDomain = getWebhookBaseDomain()) {
  const encodedSecret = secret ? `?secret=${encodeURIComponent(secret)}` : '';
  return `https://${buildWebhookHostname(prefix, baseDomain)}/webhook/tradingview${encodedSecret}`;
}
