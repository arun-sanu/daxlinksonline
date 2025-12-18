import { extractSubdomain, getWebhookBaseDomain } from '../lib/webhookDomains.js';

export function attachSubdomain() {
  const baseDomain = getWebhookBaseDomain();
  return (req, _res, next) => {
    try {
      const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : null;
      const directHost = typeof req.headers.host === 'string' ? req.headers.host : null;
      const candidateHost = forwardedHost && forwardedHost.length > 0 ? forwardedHost : directHost;
      req.subdomainPrefix = extractSubdomain(candidateHost, baseDomain);
      req.webhookBaseDomain = baseDomain;
    } catch {
      req.subdomainPrefix = null;
      req.webhookBaseDomain = baseDomain;
    }
    next();
  };
}
