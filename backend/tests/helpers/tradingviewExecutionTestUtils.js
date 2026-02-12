import crypto from 'crypto';
import nock from 'nock';

import { prisma } from '../../src/utils/prisma.js';
import { encrypt } from '../../src/lib/kms.js';

const DEFAULT_MEXC_BASE_URL = (process.env.MEXC_SPOT_BASE_URL || 'https://api.mexc.com').replace(/\/+$/, '');

function randomSuffix() {
  return crypto.randomBytes(4).toString('hex');
}

export async function resetDb() {
  await prisma.executionAudit.deleteMany({});
  await prisma.forwardedSignal.deleteMany({});
  await prisma.tradingviewAlert.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.integrationCredential.deleteMany({});
  await prisma.integration.deleteMany({});
  await prisma.dnsRecord.deleteMany({});
  await prisma.workspace.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.featureFlag.deleteMany({
    where: {
      key: {
        in: ['webhook_hmac_global', 'webhook_hmac_disable_tradingview']
      }
    }
  });
}

export async function seedBotSizingConfig({
  prefix,
  secret,
  sizingConfig
}) {
  const seed = randomSuffix();
  const effectivePrefix = prefix || `e2e-${seed}`;
  const effectiveSecret = secret || `secret-${seed}`;

  const user = await prisma.user.create({
    data: {
      email: `e2e-${seed}@example.test`,
      passwordHash: 'test-hash',
      name: 'E2E User',
      webhookSecret: effectiveSecret,
      webhookHmacKey: null,
      isActive: true
    }
  });

  const workspace = await prisma.workspace.create({
    data: {
      name: `E2E Workspace ${seed}`,
      slug: `e2e-workspace-${seed}`,
      planTier: 'pro',
      teamSize: '1-5',
      primaryUseCase: 'trading',
      region: 'us-east',
      ownerId: user.id,
      workflowConfig: {
        tradingviewExecution: {
          sizing: sizingConfig || {}
        }
      }
    }
  });

  await prisma.dnsRecord.create({
    data: {
      subdomain: effectivePrefix,
      cloudflareId: `cf-${seed}`,
      ip: '127.0.0.1',
      userId: user.id,
      status: 'active'
    }
  });

  const integration = await prisma.integration.create({
    data: {
      workspaceId: workspace.id,
      label: 'MEXC E2E',
      description: 'Jest integration',
      exchange: 'mexc',
      environment: 'live',
      apiKeyMasked: '***',
      passphraseMasked: null,
      credentialRef: `cred-${seed}`,
      rateLimit: 1200,
      bandwidth: 'standard',
      status: 'active'
    }
  });

  const apiKeyEncrypted = encrypt('test-api-key');
  const apiSecretEncrypted = encrypt('test-api-secret');
  await prisma.integrationCredential.create({
    data: {
      integrationId: integration.id,
      apiKey: apiKeyEncrypted.data,
      apiSecret: apiSecretEncrypted.data,
      passphrase: null,
      iv: apiKeyEncrypted.iv
    }
  });

  return {
    user,
    workspace,
    integration,
    prefix: effectivePrefix,
    secret: effectiveSecret
  };
}

export async function waitFor(predicate, { timeoutMs = 8000, intervalMs = 40 } = {}) {
  const timeoutNs = BigInt(Math.max(1, timeoutMs)) * 1_000_000n;
  const deadline = process.hrtime.bigint() + timeoutNs;
  while (process.hrtime.bigint() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

export async function waitForExecutionAuditStatus({
  userId,
  symbol,
  side,
  tvTs,
  statuses,
  timeoutMs = 8000
}) {
  const wanted = new Set((statuses || []).map((status) => String(status).toUpperCase()));
  return waitFor(async () => {
    const where = {
      userId,
      ...(symbol ? { symbol: String(symbol).toUpperCase() } : {}),
      ...(side ? { side: String(side).toUpperCase() } : {}),
      ...(tvTs ? { tvTs: BigInt(tvTs) } : {})
    };
    if (wanted.size) {
      where.status = { in: [...wanted] };
    }
    const row = await prisma.executionAudit.findFirst({
      where,
      orderBy: { receivedAt: 'desc' }
    });
    return row || null;
  }, { timeoutMs });
}

export function mockMexcSpotFlow({
  symbol = 'BTCUSDC',
  quoteAsset = 'USDC',
  freeQuote = 100,
  price = 50000,
  stepSize = 0.000001,
  minQty = 0.000001,
  minNotional = 5,
  orderId = '900001',
  orderStatus = 'FILLED'
} = {}) {
  nock.cleanAll();
  const scope = nock(DEFAULT_MEXC_BASE_URL);

  scope
    .get('/api/v3/account')
    .query(true)
    .reply(200, {
      balances: [
        { asset: quoteAsset, free: String(freeQuote), locked: '0' },
        { asset: 'BTC', free: '0', locked: '0' }
      ]
    });

  scope
    .get('/api/v3/ticker/price')
    .query((query) => String(query.symbol || '').toUpperCase() === String(symbol).toUpperCase())
    .reply(200, {
      symbol: String(symbol).toUpperCase(),
      price: String(price)
    });

  scope
    .get('/api/v3/exchangeInfo')
    .query((query) => String(query.symbol || '').toUpperCase() === String(symbol).toUpperCase())
    .reply(200, {
      symbols: [
        {
          symbol: String(symbol).toUpperCase(),
          baseAsset: 'BTC',
          quoteAsset,
          filters: [
            { filterType: 'LOT_SIZE', minQty: String(minQty), stepSize: String(stepSize) },
            { filterType: 'MIN_NOTIONAL', minNotional: String(minNotional) }
          ]
        }
      ]
    });

  let orderQuery = null;
  scope
    .post('/api/v3/order')
    .query((query) => {
      orderQuery = query;
      return true;
    })
    .reply(200, {
      symbol: String(symbol).toUpperCase(),
      orderId,
      status: 'NEW',
      executedQty: '0'
    });

  scope
    .get('/api/v3/order')
    .query(true)
    .reply(200, {
      symbol: String(symbol).toUpperCase(),
      orderId,
      status: orderStatus,
      executedQty: '0.001'
    });

  return {
    scope,
    getOrderQuery: () => orderQuery
  };
}

export function mockMexcForSizingOnly({
  symbol = 'BTCUSDC',
  quoteAsset = 'USDC',
  freeQuote = 10,
  price = 100,
  stepSize = 0.000001,
  minQty = 0.000001,
  minNotional = 50
} = {}) {
  nock.cleanAll();
  const scope = nock(DEFAULT_MEXC_BASE_URL);

  scope
    .get('/api/v3/account')
    .query(true)
    .reply(200, {
      balances: [{ asset: quoteAsset, free: String(freeQuote), locked: '0' }]
    });

  scope
    .get('/api/v3/ticker/price')
    .query((query) => String(query.symbol || '').toUpperCase() === String(symbol).toUpperCase())
    .reply(200, {
      symbol: String(symbol).toUpperCase(),
      price: String(price)
    });

  scope
    .get('/api/v3/exchangeInfo')
    .query((query) => String(query.symbol || '').toUpperCase() === String(symbol).toUpperCase())
    .reply(200, {
      symbols: [
        {
          symbol: String(symbol).toUpperCase(),
          baseAsset: 'BTC',
          quoteAsset,
          filters: [
            { filterType: 'LOT_SIZE', minQty: String(minQty), stepSize: String(stepSize) },
            { filterType: 'MIN_NOTIONAL', minNotional: String(minNotional) }
          ]
        }
      ]
    });

  return { scope };
}
