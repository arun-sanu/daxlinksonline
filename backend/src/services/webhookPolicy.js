import { prisma } from '../utils/prisma.js';

const FLAG_KEYS = {
  enforceGlobal: 'webhook_hmac_global',
  disableTradingview: 'webhook_hmac_disable_tradingview'
};

const CACHE_TTL_MS = Number(process.env.FLAG_CACHE_TTL_MS || 5000);
let cache = { at: 0, data: null };

export async function getWebhookHmacPolicy() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const keys = Object.values(FLAG_KEYS);
  const rows = await prisma.featureFlag.findMany({
    where: { key: { in: keys } }
  });
  const map = new Map(rows.map((row) => [row.key, row]));
  const upserts = [];
  if (!map.has(FLAG_KEYS.enforceGlobal)) {
    upserts.push(prisma.featureFlag.upsert({
      where: { key: FLAG_KEYS.enforceGlobal },
      create: { key: FLAG_KEYS.enforceGlobal, enabled: false, description: 'Require HMAC globally for inbound webhooks.' },
      update: {}
    }));
  }
  if (!map.has(FLAG_KEYS.disableTradingview)) {
    upserts.push(prisma.featureFlag.upsert({
      where: { key: FLAG_KEYS.disableTradingview },
      create: { key: FLAG_KEYS.disableTradingview, enabled: false, description: 'Disable HMAC enforcement for TradingView alerts.' },
      update: {}
    }));
  }
  if (upserts.length) {
    await Promise.all(upserts);
    const refreshed = await prisma.featureFlag.findMany({ where: { key: { in: keys } } });
    refreshed.forEach((row) => map.set(row.key, row));
  }
  const enforceGlobal = map.has(FLAG_KEYS.enforceGlobal)
    ? Boolean(map.get(FLAG_KEYS.enforceGlobal).enabled)
    : false;
  const disableTradingview = map.has(FLAG_KEYS.disableTradingview)
    ? Boolean(map.get(FLAG_KEYS.disableTradingview).enabled)
    : false;
  const data = { enforceGlobal, disableTradingview };
  cache = { at: now, data };
  return data;
}

export function getWebhookFlagKeys() {
  return { ...FLAG_KEYS };
}
