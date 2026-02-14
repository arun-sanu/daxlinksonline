import fs from 'fs';
import path from 'path';

import { prisma } from '../utils/prisma.js';
import { buildVersion, storagePathsForVersion } from '../builder/build.js';
import { getWorkspaceWorkflowConfig, saveWorkspaceWorkflowConfig } from './workflowService.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const LANGUAGE_ALIASES = Object.freeze({
  python: 'python',
  py: 'python',
  golang: 'go',
  go: 'go',
  cpp: 'cpp',
  'c++': 'cpp',
  cxx: 'cpp',
  c: 'c',
  java: 'java'
});

export const SUPPORTED_BOT_LANGUAGES = Object.freeze(['python', 'go', 'cpp', 'c', 'java']);

function httpError(message, status = 500) {
  return Object.assign(new Error(message), { status });
}

function asPositiveInt(value, fallback = DEFAULT_LIST_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

function toPlainDecimal(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (typeof value?.toString === 'function') return value.toString();
  return String(value);
}

export function normalizeBotLanguage(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  const normalized = LANGUAGE_ALIASES[raw];
  if (!normalized) {
    throw httpError(
      `Unsupported bot language "${value}". Supported languages: ${SUPPORTED_BOT_LANGUAGES.join(', ')}`,
      400
    );
  }
  return normalized;
}

export function parseVersionNotes(notes) {
  const raw = typeof notes === 'string' ? notes.trim() : '';
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Preserve old plain text notes.
  }
  return { userNotes: raw };
}

export function stringifyVersionNotes(meta = {}) {
  return JSON.stringify(meta);
}

function mergeVersionNotes(existing, patch = {}) {
  return stringifyVersionNotes({
    ...parseVersionNotes(existing),
    ...patch
  });
}

function createWorkflowNodeId(botId) {
  return `bot:${botId}`;
}

function normalizeRuntimeLink(value = null) {
  const links = value && typeof value === 'object' ? value : {};
  const webhookUrlRaw = links?.webhookUrl;
  const integrationIdRaw = links?.integrationId;
  const exchangeAccountIdRaw = links?.exchangeAccountId;

  const webhookUrl = webhookUrlRaw === null || webhookUrlRaw === undefined || webhookUrlRaw === ''
    ? null
    : String(webhookUrlRaw).trim();
  const integrationId = integrationIdRaw === null || integrationIdRaw === undefined || integrationIdRaw === ''
    ? null
    : String(integrationIdRaw).trim();
  const exchangeAccountId = exchangeAccountIdRaw === null || exchangeAccountIdRaw === undefined || exchangeAccountIdRaw === ''
    ? null
    : String(exchangeAccountIdRaw).trim();
  const updatedAt = links?.updatedAt ? String(links.updatedAt) : null;

  return {
    webhookUrl,
    integrationId,
    exchangeAccountId,
    updatedAt
  };
}

function normalizeRuntimeRules(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return JSON.parse(JSON.stringify(value));
}

function extractRuntimeConfigMap(workflowConfig = {}) {
  const map = workflowConfig?.tradeBots?.runtimeConfigs;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  return map;
}

function normalizeInstanceStatus(value) {
  const normalized = String(value || 'stopped')
    .trim()
    .toLowerCase();
  if (['running', 'paused', 'error', 'stopped'].includes(normalized)) return normalized;
  return 'stopped';
}

function presentBotVersion(version) {
  const meta = parseVersionNotes(version.notes);
  return {
    id: version.id,
    botId: version.botId,
    status: version.status,
    imageRef: version.imageRef || null,
    signedDigest: version.signedDigest || null,
    sbomRef: version.sbomRef || null,
    sdkVersion: version.sdkVersion || null,
    language: meta.language || null,
    entrypoint: meta.entrypoint || null,
    originalFilename: meta.originalFilename || null,
    uploadSizeBytes: meta.uploadSizeBytes || null,
    uploadedAt: meta.uploadedAt || null,
    userNotes: meta.userNotes || null,
    build: meta.build || null,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt
  };
}

function presentBotInstance(instance, { orderCount = 0, runCount = 0, guardrailCount = 0 } = {}) {
  return {
    id: instance.id,
    workspaceId: instance.workspaceId,
    botId: instance.botId,
    botVersionId: instance.botVersionId,
    exchangeAccountId: instance.exchangeAccountId,
    exchangeAccount: instance.exchange
      ? {
          id: instance.exchange.id,
          name: instance.exchange.name,
          venue: instance.exchange.venue,
          isSandbox: instance.exchange.isSandbox
        }
      : null,
    symbol: instance.symbol,
    direction: instance.direction,
    leverage: instance.leverage,
    maxDailyLossPct: instance.maxDailyLossPct,
    takeProfitPct: instance.takeProfitPct,
    slAtrMult: instance.slAtrMult,
    useLimitEntries: instance.useLimitEntries,
    minNotional: instance.minNotional,
    status: instance.status,
    webhookToken: instance.webhookToken,
    startedAt: instance.startedAt,
    stoppedAt: instance.stoppedAt,
    lastError: instance.lastError || null,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    counts: {
      orders: orderCount,
      runs: runCount,
      guardrailEvents: guardrailCount
    }
  };
}

function presentBotSummary(bot, { workflowNodeIds = new Set(), orderCount = 0, runCount = 0, guardrailCount = 0 } = {}) {
  const nodeId = createWorkflowNodeId(bot.id);
  return {
    id: bot.id,
    workspaceId: bot.workspaceId,
    name: bot.name,
    kind: bot.kind,
    description: bot.description || null,
    latestVersionId: bot.latestVersionId || null,
    latestVersion: bot.latestVersion ? presentBotVersion(bot.latestVersion) : null,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    counts: {
      versions: bot._count?.versions || 0,
      instances: bot._count?.instances || 0,
      rentals: bot._count?.rentals || 0,
      orders: orderCount,
      runs: runCount,
      guardrailEvents: guardrailCount
    },
    workflow: {
      nodeId,
      linked: workflowNodeIds.has(nodeId)
    }
  };
}

async function assertBotInWorkspace(workspaceId, botId) {
  const bot = await prisma.bot.findFirst({
    where: {
      id: botId,
      workspaceId
    }
  });
  if (!bot) {
    throw httpError('Trade bot not found', 404);
  }
  return bot;
}

async function assertExchangeAccountInWorkspace(workspaceId, exchangeAccountId) {
  const exchangeAccount = await prisma.exchangeAccount.findFirst({
    where: {
      id: exchangeAccountId,
      workspaceId
    }
  });
  if (!exchangeAccount) {
    throw httpError('Exchange account not found in workspace', 404);
  }
  return exchangeAccount;
}

async function ensureWorkflowNodeForBot(workspaceId, bot) {
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const customNodes = Array.isArray(cfg.customNodes) ? [...cfg.customNodes] : [];
  const nodeId = createWorkflowNodeId(bot.id);
  const nextNode = {
    id: nodeId,
    side: 'source',
    label: bot.name,
    nodeType: 'trade-bot',
    description: bot.description || `Trade bot: ${bot.name}`
  };

  const idx = customNodes.findIndex((node) => node?.id === nodeId);
  if (idx === -1) {
    customNodes.push(nextNode);
    await saveWorkspaceWorkflowConfig(workspaceId, {
      ...cfg,
      customNodes
    });
    return nodeId;
  }

  const current = customNodes[idx] || {};
  if (
    current.label !== nextNode.label ||
    current.nodeType !== nextNode.nodeType ||
    current.side !== nextNode.side ||
    current.description !== nextNode.description
  ) {
    customNodes[idx] = {
      ...current,
      ...nextNode
    };
    await saveWorkspaceWorkflowConfig(workspaceId, {
      ...cfg,
      customNodes
    });
  }
  return nodeId;
}

async function collectInstanceAggregates(instanceIds = []) {
  if (!instanceIds.length) {
    return {
      orderCountsByInstance: new Map(),
      runCountsByInstance: new Map(),
      guardrailCountsByInstance: new Map()
    };
  }

  const [orderCounts, runCounts, guardrailCounts] = await Promise.all([
    prisma.order.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    }),
    prisma.botRun.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    }),
    prisma.guardrailEvent.groupBy({
      by: ['botInstanceId'],
      where: { botInstanceId: { in: instanceIds } },
      _count: { _all: true }
    })
  ]);

  return {
    orderCountsByInstance: new Map(orderCounts.map((row) => [row.botInstanceId, row._count?._all || 0])),
    runCountsByInstance: new Map(runCounts.map((row) => [row.botInstanceId, row._count?._all || 0])),
    guardrailCountsByInstance: new Map(guardrailCounts.map((row) => [row.botInstanceId, row._count?._all || 0]))
  };
}

export function listSupportedBotLanguages() {
  return SUPPORTED_BOT_LANGUAGES;
}

export async function listTradeBots(workspaceId) {
  const [workspace, bots, instances] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { workflowConfig: true }
    }),
    prisma.bot.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      include: {
        latestVersion: true,
        _count: {
          select: {
            versions: true,
            instances: true,
            rentals: true
          }
        }
      }
    }),
    prisma.botInstance.findMany({
      where: {
        workspaceId
      },
      select: {
        id: true,
        botId: true
      }
    })
  ]);

  const workflowNodeIds = new Set(
    ((workspace?.workflowConfig?.customNodes && Array.isArray(workspace.workflowConfig.customNodes))
      ? workspace.workflowConfig.customNodes
      : []
    )
      .map((node) => node?.id)
      .filter(Boolean)
  );
  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );

  const perBotCounts = new Map();
  instances.forEach((instance) => {
    const current = perBotCounts.get(instance.botId) || { orders: 0, runs: 0, guardrailEvents: 0 };
    current.orders += orderCountsByInstance.get(instance.id) || 0;
    current.runs += runCountsByInstance.get(instance.id) || 0;
    current.guardrailEvents += guardrailCountsByInstance.get(instance.id) || 0;
    perBotCounts.set(instance.botId, current);
  });

  return bots.map((bot) => {
    const summaryCounts = perBotCounts.get(bot.id) || { orders: 0, runs: 0, guardrailEvents: 0 };
    return presentBotSummary(bot, {
      workflowNodeIds,
      orderCount: summaryCounts.orders,
      runCount: summaryCounts.runs,
      guardrailCount: summaryCounts.guardrailEvents
    });
  });
}

export async function createTradeBot(workspaceId, payload) {
  const bot = await prisma.bot.create({
    data: {
      workspaceId,
      name: payload.name,
      kind: payload.kind || 'code',
      description: payload.description || null
    }
  });
  await ensureWorkflowNodeForBot(workspaceId, bot);
  return getTradeBotDetail(workspaceId, bot.id);
}

export async function getTradeBotDetail(workspaceId, botId) {
  const [workspace, bot, instances] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { workflowConfig: true }
    }),
    prisma.bot.findFirst({
      where: {
        id: botId,
        workspaceId
      },
      include: {
        latestVersion: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 50
        },
        _count: {
          select: {
            versions: true,
            instances: true,
            rentals: true
          }
        }
      }
    }),
    prisma.botInstance.findMany({
      where: {
        botId,
        workspaceId
      },
      orderBy: { createdAt: 'desc' },
      include: {
        exchange: {
          select: {
            id: true,
            name: true,
            venue: true,
            isSandbox: true
          }
        }
      }
    })
  ]);

  if (!bot) {
    throw httpError('Trade bot not found', 404);
  }

  const workflowNodeIds = new Set(
    ((workspace?.workflowConfig?.customNodes && Array.isArray(workspace.workflowConfig.customNodes))
      ? workspace.workflowConfig.customNodes
      : []
    )
      .map((node) => node?.id)
      .filter(Boolean)
  );

  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );
  const orderCount = instanceIds.reduce((sum, id) => sum + (orderCountsByInstance.get(id) || 0), 0);
  const runCount = instanceIds.reduce((sum, id) => sum + (runCountsByInstance.get(id) || 0), 0);
  const guardrailCount = instanceIds.reduce((sum, id) => sum + (guardrailCountsByInstance.get(id) || 0), 0);

  const nodeId = createWorkflowNodeId(bot.id);
  const base = presentBotSummary(bot, {
    workflowNodeIds,
    orderCount,
    runCount,
    guardrailCount
  });

  return {
    ...base,
    versions: (bot.versions || []).map((version) => presentBotVersion(version)),
    instances: instances.map((instance) =>
      presentBotInstance(instance, {
        orderCount: orderCountsByInstance.get(instance.id) || 0,
        runCount: runCountsByInstance.get(instance.id) || 0,
        guardrailCount: guardrailCountsByInstance.get(instance.id) || 0
      })
    ),
    links: {
      orders: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/orders`,
      monitoring: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/monitoring`,
      workflow: `/api/v1/trade-bots/${workspaceId}/bots/${bot.id}/workflow`,
      workflowNodeId: nodeId
    }
  };
}

export async function getTradeBotRuntimeConfig(workspaceId, botId) {
  await assertBotInWorkspace(workspaceId, botId);
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(cfg);
  const current = runtimeMap[botId] && typeof runtimeMap[botId] === 'object' ? runtimeMap[botId] : {};
  const links = normalizeRuntimeLink(current.links || null);
  const rules = normalizeRuntimeRules(current.rules || null);

  return {
    workspaceId,
    botId,
    links,
    rules,
    updatedAt: current.updatedAt || links.updatedAt || null
  };
}

export async function upsertTradeBotRuntimeConfig(workspaceId, botId, payload = {}) {
  await assertBotInWorkspace(workspaceId, botId);
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const runtimeMap = extractRuntimeConfigMap(cfg);
  const previous = runtimeMap[botId] && typeof runtimeMap[botId] === 'object' ? runtimeMap[botId] : {};

  const nextLinks = Object.prototype.hasOwnProperty.call(payload, 'links')
    ? normalizeRuntimeLink(payload.links || null)
    : normalizeRuntimeLink(previous.links || null);
  const nextRules = Object.prototype.hasOwnProperty.call(payload, 'rules')
    ? normalizeRuntimeRules(payload.rules || null)
    : normalizeRuntimeRules(previous.rules || null);

  const nextEntry = {
    links: nextLinks,
    rules: nextRules,
    updatedAt: new Date().toISOString()
  };

  const nextRuntimeMap = {
    ...runtimeMap,
    [botId]: nextEntry
  };

  const nextConfig = {
    ...cfg,
    tradeBots: {
      ...(cfg.tradeBots && typeof cfg.tradeBots === 'object' ? cfg.tradeBots : {}),
      runtimeConfigs: nextRuntimeMap
    }
  };

  await saveWorkspaceWorkflowConfig(workspaceId, nextConfig);
  return {
    workspaceId,
    botId,
    ...nextEntry
  };
}

function assertZipFilename(filename) {
  const name = String(filename || '').trim().toLowerCase();
  if (!name.endsWith('.zip')) {
    throw httpError('Only .zip bot bundles are supported for upload', 400);
  }
}

async function runBuildAndPersistVersion({ bot, version, zipPath, autoPublish = false }) {
  let buildResult;
  try {
    buildResult = await buildVersion({
      botId: bot.id,
      versionId: version.id,
      zipPath
    });
  } catch (error) {
    const rejected = await prisma.botVersion.update({
      where: { id: version.id },
      data: {
        status: 'rejected',
        notes: mergeVersionNotes(version.notes, {
          build: {
            status: 'rejected',
            reasons: [error?.message || 'Build failed']
          }
        })
      }
    });
    return {
      version: rejected,
      buildResult: {
        status: 'rejected',
        reasons: [error?.message || 'Build failed']
      }
    };
  }

  if (buildResult.status !== 'approved') {
    const rejected = await prisma.botVersion.update({
      where: { id: version.id },
      data: {
        status: 'rejected',
        notes: mergeVersionNotes(version.notes, {
          build: {
            status: 'rejected',
            reasons: buildResult.reasons || []
          }
        })
      }
    });
    return { version: rejected, buildResult };
  }

  const nextStatus = autoPublish ? 'published' : 'approved';
  const approved = await prisma.botVersion.update({
    where: { id: version.id },
    data: {
      status: nextStatus,
      imageRef: buildResult.imageRef || null,
      signedDigest: buildResult.signedDigest || null,
      sbomRef: buildResult.sbomRef || null,
      notes: mergeVersionNotes(version.notes, {
        build: {
          status: nextStatus,
          scanRef: buildResult.scanRef || null
        }
      })
    }
  });

  await prisma.bot.update({
    where: { id: bot.id },
    data: { latestVersionId: approved.id }
  });

  return { version: approved, buildResult };
}

export async function uploadTradeBotVersion({
  workspaceId,
  botId,
  language,
  entrypoint,
  userNotes,
  autoPublish = false,
  file
}) {
  if (!file?.buffer || !file?.size) {
    throw httpError('Bot ZIP file is required', 400);
  }

  const bot = await assertBotInWorkspace(workspaceId, botId);
  const normalizedLanguage = normalizeBotLanguage(language);
  assertZipFilename(file.originalname);

  const version = await prisma.botVersion.create({
    data: {
      botId: bot.id,
      status: 'draft',
      notes: stringifyVersionNotes({
        language: normalizedLanguage,
        entrypoint: entrypoint || null,
        originalFilename: file.originalname || null,
        uploadSizeBytes: file.size || null,
        uploadedAt: new Date().toISOString(),
        userNotes: userNotes || null
      })
    }
  });

  const { zipPath } = storagePathsForVersion(version.id);
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, file.buffer);

  const { version: finalizedVersion, buildResult } = await runBuildAndPersistVersion({
    bot,
    version,
    zipPath,
    autoPublish
  });

  return {
    botId: bot.id,
    version: presentBotVersion(finalizedVersion),
    build: buildResult
  };
}

export async function createTradeBotInstance(workspaceId, botId, payload) {
  const bot = await assertBotInWorkspace(workspaceId, botId);
  const exchangeAccount = await assertExchangeAccountInWorkspace(workspaceId, payload.exchangeAccountId);

  const resolvedVersionId = payload.botVersionId || bot.latestVersionId;
  if (!resolvedVersionId) {
    throw httpError('No bot version available. Upload a bot bundle first.', 400);
  }

  const version = await prisma.botVersion.findFirst({
    where: {
      id: resolvedVersionId,
      botId: bot.id
    }
  });
  if (!version) {
    throw httpError('Bot version not found for this bot', 404);
  }
  if (!['approved', 'published', 'built', 'scanned'].includes(String(version.status || '').toLowerCase())) {
    throw httpError('Bot version must be approved or published before creating an instance', 400);
  }

  const instance = await prisma.botInstance.create({
    data: {
      botId: bot.id,
      botVersionId: version.id,
      workspaceId,
      exchangeAccountId: exchangeAccount.id,
      symbol: String(payload.symbol || '').toUpperCase(),
      direction: String(payload.direction || 'both').toLowerCase(),
      leverage: Number(payload.leverage || 1),
      maxDailyLossPct: Number(payload.maxDailyLossPct || 5),
      takeProfitPct: Number(payload.takeProfitPct || 1),
      slAtrMult: Number(payload.slAtrMult || 1.5),
      useLimitEntries: payload.useLimitEntries !== undefined ? Boolean(payload.useLimitEntries) : true,
      minNotional: Number(payload.minNotional || 1),
      status: normalizeInstanceStatus(payload.status)
    },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });
  return presentBotInstance(instance);
}

export async function listTradeBotInstances(workspaceId, botId) {
  await assertBotInWorkspace(workspaceId, botId);
  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId
    },
    orderBy: { createdAt: 'desc' },
    include: {
      exchange: {
        select: {
          id: true,
          name: true,
          venue: true,
          isSandbox: true
        }
      }
    }
  });
  const instanceIds = instances.map((instance) => instance.id);
  const { orderCountsByInstance, runCountsByInstance, guardrailCountsByInstance } = await collectInstanceAggregates(
    instanceIds
  );
  return instances.map((instance) =>
    presentBotInstance(instance, {
      orderCount: orderCountsByInstance.get(instance.id) || 0,
      runCount: runCountsByInstance.get(instance.id) || 0,
      guardrailCount: guardrailCountsByInstance.get(instance.id) || 0
    })
  );
}

export async function listTradeBotOrders(workspaceId, botId, filters = {}) {
  await assertBotInWorkspace(workspaceId, botId);
  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId,
      ...(filters.instanceId ? { id: filters.instanceId } : {})
    },
    select: { id: true, symbol: true, status: true }
  });
  const instanceIds = instances.map((instance) => instance.id);
  if (!instanceIds.length) {
    return { total: 0, items: [] };
  }

  const items = await prisma.order.findMany({
    where: {
      botInstanceId: { in: instanceIds },
      ...(filters.symbol ? { symbol: String(filters.symbol).toUpperCase() } : {}),
      ...(filters.status ? { status: String(filters.status) } : {})
    },
    orderBy: { createdAt: 'desc' },
    take: asPositiveInt(filters.limit, DEFAULT_LIST_LIMIT)
  });

  const instanceMap = new Map(instances.map((instance) => [instance.id, instance]));
  return {
    total: items.length,
    items: items.map((item) => ({
      id: item.id,
      botInstanceId: item.botInstanceId,
      instance: instanceMap.get(item.botInstanceId) || null,
      venue: item.venue,
      symbol: item.symbol,
      side: item.side,
      type: item.type,
      status: item.status,
      venueOrderId: item.venueOrderId || null,
      error: item.error || null,
      price: toPlainDecimal(item.price),
      qty: toPlainDecimal(item.qty),
      quoteSpend: toPlainDecimal(item.quoteSpend),
      qtyRaw: toPlainDecimal(item.qtyRaw),
      qtyFinal: toPlainDecimal(item.qtyFinal),
      refPrice: toPlainDecimal(item.refPrice),
      minNotional: toPlainDecimal(item.minNotional),
      stepSize: toPlainDecimal(item.stepSize),
      riskMode: item.riskMode || null,
      riskValue: toPlainDecimal(item.riskValue),
      slPrice: toPlainDecimal(item.slPrice),
      tpPrice: toPlainDecimal(item.tpPrice),
      sizingStatus: item.sizingStatus || null,
      sizingRejectReason: item.sizingRejectReason || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  };
}

export async function getTradeBotMonitoring(workspaceId, botId, filters = {}) {
  await assertBotInWorkspace(workspaceId, botId);
  const instances = await prisma.botInstance.findMany({
    where: {
      workspaceId,
      botId,
      ...(filters.instanceId ? { id: filters.instanceId } : {})
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      symbol: true,
      status: true,
      startedAt: true,
      stoppedAt: true,
      lastError: true
    }
  });
  const instanceIds = instances.map((instance) => instance.id);
  if (!instanceIds.length) {
    return {
      summary: {
        running: 0,
        paused: 0,
        stopped: 0,
        error: 0
      },
      runs: [],
      guardrailEvents: [],
      positions: []
    };
  }

  const limit = asPositiveInt(filters.limit, DEFAULT_LIST_LIMIT);
  const [runs, guardrailEvents, positions] = await Promise.all([
    prisma.botRun.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { startedAt: 'desc' },
      take: limit
    }),
    prisma.guardrailEvent.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    prisma.position.findMany({
      where: { botInstanceId: { in: instanceIds } },
      orderBy: { openedAt: 'desc' },
      take: limit
    })
  ]);

  const summary = instances.reduce(
    (acc, instance) => {
      const key = normalizeInstanceStatus(instance.status);
      acc[key] += 1;
      return acc;
    },
    { running: 0, paused: 0, stopped: 0, error: 0 }
  );

  return {
    summary,
    instances,
    runs: runs.map((run) => ({
      id: run.id,
      botInstanceId: run.botInstanceId,
      status: run.status,
      error: run.error || null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      metrics: run.metricsJson || null
    })),
    guardrailEvents: guardrailEvents.map((event) => ({
      id: event.id,
      botInstanceId: event.botInstanceId,
      type: event.type,
      detail: event.detail || null,
      createdAt: event.createdAt
    })),
    positions: positions.map((position) => ({
      id: position.id,
      botInstanceId: position.botInstanceId,
      symbol: position.symbol,
      side: position.side,
      entryPrice: toPlainDecimal(position.entryPrice),
      qty: toPlainDecimal(position.qty),
      pnl: toPlainDecimal(position.pnl),
      openedAt: position.openedAt,
      closedAt: position.closedAt
    }))
  };
}

export async function getTradeBotWorkflowLink(workspaceId, botId) {
  const bot = await assertBotInWorkspace(workspaceId, botId);
  const cfg = await getWorkspaceWorkflowConfig(workspaceId);
  const nodeId = createWorkflowNodeId(bot.id);
  const customNodes = Array.isArray(cfg.customNodes) ? cfg.customNodes : [];
  const node = customNodes.find((entry) => entry?.id === nodeId) || null;
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const linkedRules = rules.filter((rule) => rule?.source?.id === nodeId);

  return {
    workflowNodeId: nodeId,
    linked: Boolean(node),
    node,
    linkedRuleCount: linkedRules.length,
    linkedRules,
    workflowConfigVersion: cfg.version || 1
  };
}

function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function presentMarketplacePlan(plan) {
  return {
    id: plan.id,
    workspaceId: plan.workspaceId,
    name: plan.name,
    cpuMilli: plan.cpuMilli,
    memMiB: plan.memMiB,
    priceMonthly: plan.priceMonthly,
    active: Boolean(plan.active)
  };
}

function presentRental(rental) {
  return {
    id: rental.id,
    botId: rental.botId,
    renterWorkspaceId: rental.renterWorkspaceId,
    planId: rental.planId,
    exchangeAccountId: rental.exchangeAccountId,
    botInstanceId: rental.botInstanceId || null,
    status: rental.status,
    revenueShareBps: rental.revenueShareBps,
    createdAt: rental.createdAt,
    expiresAt: rental.expiresAt,
    bot: rental.bot
      ? {
          id: rental.bot.id,
          workspaceId: rental.bot.workspaceId,
          name: rental.bot.name,
          kind: rental.bot.kind,
          description: rental.bot.description || null,
          latestVersionId: rental.bot.latestVersionId || null,
          createdAt: rental.bot.createdAt,
          updatedAt: rental.bot.updatedAt
        }
      : null,
    plan: rental.plan ? presentMarketplacePlan(rental.plan) : null,
    exchangeAccount: rental.exchangeAccount
      ? {
          id: rental.exchangeAccount.id,
          workspaceId: rental.exchangeAccount.workspaceId,
          name: rental.exchangeAccount.name,
          venue: rental.exchangeAccount.venue,
          isSandbox: rental.exchangeAccount.isSandbox,
          createdAt: rental.exchangeAccount.createdAt,
          updatedAt: rental.exchangeAccount.updatedAt
        }
      : null,
    instance: rental.instance ? presentBotInstance(rental.instance) : null
  };
}

export async function listMarketBots(_workspaceId) {
  const bots = await prisma.bot.findMany({
    where: { latestVersionId: { not: null } },
    orderBy: { updatedAt: 'desc' },
    include: {
      workspace: {
        select: { id: true, name: true }
      }
    }
  });
  if (!bots.length) return [];

  const latestVersionIds = Array.from(
    new Set(
      bots
        .map((bot) => bot.latestVersionId)
        .filter(Boolean)
    )
  );
  const [versions, plans] = await Promise.all([
    prisma.botVersion.findMany({
      where: {
        id: { in: latestVersionIds },
        status: { in: ['published', 'approved'] }
      },
      select: {
        id: true,
        status: true,
        createdAt: true
      }
    }),
    prisma.plan.findMany({
      where: {
        workspaceId: { in: Array.from(new Set(bots.map((bot) => bot.workspaceId))) },
        active: true
      },
      orderBy: [{ priceMonthly: 'asc' }, { name: 'asc' }]
    })
  ]);
  const versionsById = new Map(versions.map((version) => [version.id, version]));
  const plansByWorkspace = new Map();
  plans.forEach((plan) => {
    if (!plansByWorkspace.has(plan.workspaceId)) {
      plansByWorkspace.set(plan.workspaceId, []);
    }
    plansByWorkspace.get(plan.workspaceId).push(plan);
  });

  return bots
    .filter((bot) => bot.latestVersionId && versionsById.has(bot.latestVersionId))
    .map((bot) => {
      const latestVersion = versionsById.get(bot.latestVersionId);
      return {
        id: bot.id,
        name: bot.name,
        description: bot.description || null,
        workspace: {
          id: bot.workspace.id,
          name: bot.workspace.name
        },
        publishedAt: latestVersion?.createdAt || null,
        updatedAt: bot.updatedAt,
        versionId: bot.latestVersionId,
        plans: (plansByWorkspace.get(bot.workspaceId) || []).map((plan) => presentMarketplacePlan(plan))
      };
    });
}

export async function rentMarketBot(workspaceId, botId, payload = {}) {
  const symbol = String(payload.symbol || 'BTCUSDT')
    .trim()
    .toUpperCase();
  const [workspace, bot, exchangeAccount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true }
    }),
    prisma.bot.findUnique({
      where: { id: botId },
      select: {
        id: true,
        workspaceId: true,
        latestVersionId: true
      }
    }),
    prisma.exchangeAccount.findFirst({
      where: {
        id: payload.exchangeAccountId,
        workspaceId
      }
    })
  ]);

  if (!workspace) throw httpError('Workspace not found', 404);
  if (!bot?.latestVersionId) throw httpError('Bot is not published in marketplace', 404);
  if (!exchangeAccount) throw httpError('Exchange account not found in workspace', 404);

  const [version, plan] = await Promise.all([
    prisma.botVersion.findFirst({
      where: {
        id: bot.latestVersionId,
        botId: bot.id,
        status: { in: ['published', 'approved'] }
      }
    }),
    prisma.plan.findFirst({
      where: {
        id: payload.planId,
        workspaceId: bot.workspaceId,
        active: true
      }
    })
  ]);
  if (!version) throw httpError('Bot latest version is not published', 400);
  if (!plan) throw httpError('Selected plan is not available for this marketplace bot', 404);

  const instance = await prisma.botInstance.create({
    data: {
      botId: bot.id,
      botVersionId: version.id,
      workspaceId,
      exchangeAccountId: exchangeAccount.id,
      symbol: symbol || 'BTCUSDT',
      direction: 'both',
      leverage: 1,
      maxDailyLossPct: 5,
      takeProfitPct: 1,
      slAtrMult: 1.5,
      useLimitEntries: true,
      minNotional: 1,
      status: 'stopped'
    }
  });

  const rental = await prisma.rental.create({
    data: {
      botId: bot.id,
      renterWorkspaceId: workspaceId,
      planId: plan.id,
      exchangeAccountId: exchangeAccount.id,
      botInstanceId: instance.id,
      status: 'active',
      expiresAt: addDays(new Date(), 30)
    }
  });

  return {
    rentalId: rental.id,
    instanceId: instance.id
  };
}

export async function listWorkspaceRentals(workspaceId) {
  const rentals = await prisma.rental.findMany({
    where: {
      renterWorkspaceId: workspaceId
    },
    orderBy: { createdAt: 'desc' },
    include: {
      bot: true,
      plan: true,
      exchangeAccount: true,
      instance: {
        include: {
          exchange: {
            select: {
              id: true,
              name: true,
              venue: true,
              isSandbox: true
            }
          }
        }
      }
    }
  });
  return rentals.map((rental) => presentRental(rental));
}
