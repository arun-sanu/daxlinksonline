import { getWebhookBaseDomain } from '../lib/webhookDomains.js';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
let cachedZoneId = null;

function requireToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN is not configured');
  }
  return token;
}

export async function getCloudflareZoneId() {
  if (process.env.CLOUDFLARE_ZONE_ID) {
    return process.env.CLOUDFLARE_ZONE_ID;
  }
  if (cachedZoneId) {
    return cachedZoneId;
  }
  const token = requireToken();
  const domain = getWebhookBaseDomain();
  const resp = await fetch(`${CF_API_BASE}/zones?name=${domain}&status=active`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success || !data?.result?.length) {
    const message = data?.errors?.[0]?.message || `Unable to locate zone for ${domain}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  cachedZoneId = data.result[0].id;
  return cachedZoneId;
}

export async function createDnsRecord({ type = 'A', name, content, proxied = false, ttl = 120 }) {
  const token = requireToken();
  const zoneId = await getCloudflareZoneId();
  const resp = await fetch(`${CF_API_BASE}/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ type, name, content, proxied, ttl })
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.success) {
    const message = data?.errors?.[0]?.message || `Cloudflare error (${resp.status})`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  return data.result;
}

export async function deleteDnsRecord(recordId) {
  const token = requireToken();
  const zoneId = await getCloudflareZoneId();
  const resp = await fetch(`${CF_API_BASE}/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    const message = data?.errors?.[0]?.message || `Cloudflare delete failed (${resp.status})`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  return true;
}
