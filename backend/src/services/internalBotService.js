import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';

function httpError(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function normalizeId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeRuntimeLink(value = null) {
  const links = value && typeof value === 'object' ? value : {};
  const webhookUrl = normalizeId(links.webhookUrl);
  const integrationId = normalizeId(links.integrationId);
  const exchangeAccountId = normalizeId(links.exchangeAccountId);
  const updatedAt = normalizeId(links.updatedAt);

  return {
    webhookUrl,
    integrationId,
    exchangeAccountId,
    updatedAt
  };
}

function decryptBase64Secret(encodedValue, label, { required = true } = {}) {
  const value = String(encodedValue || '').trim();
  if (!value) {
    if (!required) return null;
    throw httpError(`${label} is missing`, 500);
  }
  try {
    return decrypt(Buffer.from(value, 'base64'));
  } catch (error) {
    throw httpError(`Failed to decrypt ${label}`, 500);
  }
}

function toSafeRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

async function resolveExchangeAccount(instance, runtimeLinks) {
  const linkedExchangeAccountId = normalizeId(runtimeLinks?.exchangeAccountId);
  const fallbackAccountId = normalizeId(instance.exchangeAccountId);
  // Prefer the exchange account linked directly to this bot instance.
  // Runtime link override is used only when instance linkage is missing.
  const targetExchangeAccountId = fallbackAccountId || linkedExchangeAccountId;

  if (!targetExchangeAccountId) {
    throw httpError('Bot instance has no linked exchange account', 400);
  }

  const exchangeAccount = await prisma.exchangeAccount.findFirst({
    where: {
      id: targetExchangeAccountId,
      workspaceId: instance.workspaceId
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      venue: true,
      isSandbox: true,
      apiKeyEnc: true,
      apiSecretEnc: true,
      passphraseEnc: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!exchangeAccount) {
    throw httpError('Linked exchange account not found in workspace', 404);
  }
  return exchangeAccount;
}

export async function resolveInternalBotRuntime({ botInstanceId }) {
  const instanceId = normalizeId(botInstanceId);
  if (!instanceId) {
    throw httpError('botInstanceId is required', 400);
  }

  const instance = await prisma.botInstance.findUnique({
    where: { id: instanceId },
    include: {
      bot: {
        select: {
          id: true,
          name: true
        }
      },
      workspace: {
        select: {
          id: true,
          workflowConfig: true
        }
      }
    }
  });

  if (!instance) {
    throw httpError('Bot instance not found', 404);
  }

  const runtimeMap = instance.workspace?.workflowConfig?.tradeBots?.runtimeConfigs;
  const runtimeEntry =
    runtimeMap && typeof runtimeMap === 'object' && runtimeMap[instance.botId] && typeof runtimeMap[instance.botId] === 'object'
      ? runtimeMap[instance.botId]
      : {};
  const runtimeLinks = normalizeRuntimeLink(runtimeEntry.links || null);
  const runtimeRules = toSafeRules(runtimeEntry.rules || null);

  const exchangeAccount = await resolveExchangeAccount(instance, runtimeLinks);

  return {
    ok: true,
    botInstance: {
      id: instance.id,
      workspaceId: instance.workspaceId,
      botId: instance.botId,
      botName: instance.bot?.name || null,
      symbol: instance.symbol,
      direction: instance.direction,
      status: instance.status,
      exchangeAccountId: exchangeAccount.id,
      configuredExchangeAccountId: instance.exchangeAccountId
    },
    exchangeAccount: {
      id: exchangeAccount.id,
      workspaceId: exchangeAccount.workspaceId,
      name: exchangeAccount.name,
      venue: exchangeAccount.venue,
      isSandbox: exchangeAccount.isSandbox,
      apiKey: decryptBase64Secret(exchangeAccount.apiKeyEnc, 'exchangeAccount.apiKey'),
      apiSecret: decryptBase64Secret(exchangeAccount.apiSecretEnc, 'exchangeAccount.apiSecret'),
      passphrase: decryptBase64Secret(exchangeAccount.passphraseEnc, 'exchangeAccount.passphrase', { required: false }),
      createdAt: exchangeAccount.createdAt,
      updatedAt: exchangeAccount.updatedAt
    },
    runtime: {
      links: runtimeLinks,
      rules: runtimeRules,
      updatedAt: normalizeId(runtimeEntry.updatedAt) || runtimeLinks.updatedAt
    }
  };
}
