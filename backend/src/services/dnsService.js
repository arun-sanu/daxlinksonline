import { prisma } from '../utils/prisma.js';
import { getWebhookBaseDomain } from '../lib/webhookDomains.js';
import { createDnsRecord, deleteDnsRecord, getCloudflareZoneId } from '../utils/cloudflare.js';

const RESERVED_SUBDOMAINS = new Set(['admin', 'api', 'app', 'www', 'webhook', 'mail', 'support']);

function normalizeSubdomain(name) {
  return String(name || '').trim().toLowerCase();
}

function isValidSubdomain(name) {
  if (typeof name !== 'string') return false;
  const s = normalizeSubdomain(name);
  if (s.length < 3 || s.length > 63) return false;
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
  const normalized = normalizeSubdomain(subdomain);
  if (!normalized) {
    return { available: false, reason: 'Subdomain required' };
  }
  if (!isValidSubdomain(normalized)) {
    return { available: false, reason: 'Invalid format' };
  }
  if (RESERVED_SUBDOMAINS.has(normalized)) {
    return { available: false, reason: 'Reserved subdomain' };
  }
  const usedByUser = await prisma.user.findFirst({
    where: {
      OR: [{ webhookSubdomain: normalized }, { subdomainPrefix: normalized }]
    }
  });
  if (usedByUser) {
    return { available: false, reason: 'Already assigned to a user' };
  }
  const usedByDns = await prisma.dnsRecord.findFirst({ where: { subdomain: normalized } });
  if (usedByDns) {
    return { available: false, reason: 'Already registered' };
  }
  return { available: true, reason: null, name: normalized };
}

function mapRecord(record, baseDomain) {
  return {
    id: record.id,
    name: record.subdomain,
    subdomain: record.subdomain,
    ip: record.ip || '',
    status: record.status || 'active',
    cloudflareId: record.cloudflareId || '',
    createdAt: record.createdAt?.toISOString?.() || new Date().toISOString(),
    host: `${record.subdomain}.${baseDomain}`,
    url: `https://${record.subdomain}.${baseDomain}`
  };
}

export async function registerCustomDns({ userId, subdomain, ip }) {
  const normalized = normalizeSubdomain(subdomain);
  if (!isValidSubdomain(normalized)) {
    throw Object.assign(new Error('Invalid subdomain'), { status: 400 });
  }
  if (isPrivateIp(ip)) {
    throw Object.assign(new Error('IP must be public'), { status: 400 });
  }
  const { available, reason } = await isSubdomainAvailable(normalized);
  if (!available) {
    const err = new Error(reason || 'Subdomain not available');
    err.status = reason === 'Invalid format' ? 400 : 409;
    throw err;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.isActive === false) throw Object.assign(new Error('User inactive'), { status: 403 });
  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    throw Object.assign(new Error('Trial expired'), { status: 403 });
  }

  const baseDomain = getWebhookBaseDomain();
  await getCloudflareZoneId();
  const recordName = `${normalized}.${baseDomain}`;
  const recordResult = await createDnsRecord({ type: 'A', name: recordName, content: ip, proxied: false, ttl: 120 });
  const cloudflareId = recordResult?.id;
  const record = await prisma.dnsRecord.create({
    data: { subdomain: normalized, cloudflareId, userId, ip, status: 'active' }
  });
  return mapRecord({ ...record, createdAt: record.createdAt }, baseDomain);
}

export async function deleteDnsRecordById(recordId) {
  try {
    await deleteDnsRecord(recordId);
    return true;
  } catch (err) {
    console.warn('[dns] failed to delete Cloudflare record', err?.message || err);
    return false;
  }
}

export async function listMyDns({ userId }) {
  const baseDomain = getWebhookBaseDomain();
  const records = await prisma.dnsRecord.findMany({
    where: { userId },
    orderBy: { subdomain: 'asc' },
    select: { id: true, subdomain: true, ip: true, cloudflareId: true, status: true, createdAt: true }
  });
  return records.map((r) => mapRecord(r, baseDomain));
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
