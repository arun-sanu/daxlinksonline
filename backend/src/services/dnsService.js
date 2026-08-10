import { prisma } from '../utils/prisma.js';

function isValidSubdomain(name) {
  if (typeof name !== 'string') return false;
  const s = name.trim().toLowerCase();
  if (s.length < 1 || s.length > 63) return false;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)) return false;
  return true;
}

function isPrivateIp(ip) {
  // IPv4 simple checks
  const parts = ip.split('.').map((x) => parseInt(x, 10));
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // Basic IPv6 exclusions
  if (ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80') || ip === '::1') return true;
  return false;
}

export async function isSubdomainAvailable(subdomain) {
  if (!isValidSubdomain(subdomain)) return false;
  const usedByUser = await prisma.user.findFirst({ where: { webhookSubdomain: subdomain } });
  if (usedByUser) return false;
  const usedByDns = await prisma.dnsRecord.findFirst({ where: { subdomain } });
  return !usedByDns;
}

export async function registerCustomDns({ userId, subdomain, ip }) {
  if (!isValidSubdomain(subdomain)) {
    throw Object.assign(new Error('Invalid subdomain'), { status: 400 });
  }
  if (isPrivateIp(ip)) {
    throw Object.assign(new Error('IP must be public'), { status: 400 });
  }
  const available = await isSubdomainAvailable(subdomain);
  if (!available) {
    throw Object.assign(new Error('Subdomain not available'), { status: 409 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.isActive === false) throw Object.assign(new Error('User inactive'), { status: 403 });
  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    throw Object.assign(new Error('Trial expired'), { status: 403 });
  }

  const baseDomain = process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link';
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token) throw Object.assign(new Error('Cloudflare not configured'), { status: 500 });

  const recordName = `${subdomain}.${baseDomain}`;
  const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      type: 'A',
      name: recordName,
      content: ip,
      proxied: false,
      ttl: 120
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.success) {
    const message = data?.errors?.[0]?.message || `Cloudflare error (${resp.status})`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const cloudflareId = data?.result?.id;
  await prisma.dnsRecord.create({ data: { subdomain, cloudflareId, userId, ip } });
  return { url: `https://${recordName}` };
}

export async function deleteDnsRecordById(recordId) {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token) throw new Error('Cloudflare not configured');
  const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  // ignore response; CF returns success boolean
  return resp.ok;
}

export async function listMyDns({ userId }) {
  const baseDomain = process.env.WEBHOOK_BASE_DOMAIN || 'daxlinksonline.link';
  const records = await prisma.dnsRecord.findMany({
    where: { userId },
    orderBy: { subdomain: 'asc' },
    select: { id: true, subdomain: true, ip: true, cloudflareId: true }
  });
  return records.map((r) => ({
    id: r.id,
    subdomain: r.subdomain,
    host: `${r.subdomain}.${baseDomain}`,
    url: `https://${r.subdomain}.${baseDomain}`,
    ip: r.ip || null,
    cloudflareId: r.cloudflareId
  }));
}

export async function deleteDnsForUser({ id, userId }) {
  const record = await prisma.dnsRecord.findFirst({ where: { id, userId } });
  if (!record) {
    const err = new Error('DNS record not found');
    err.status = 404;
    throw err;
  }
  try {
    await deleteDnsRecordById(record.cloudflareId);
  } catch {}
  await prisma.dnsRecord.delete({ where: { id } });
  return { ok: true };
}
