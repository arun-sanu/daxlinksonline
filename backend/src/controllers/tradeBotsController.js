import { z } from 'zod';

import {
  createTradeBot,
  createTradeBotInstance,
  getTradeBotDetail,
  getTradeBotMonitoring,
  getTradeBotWorkflowLink,
  listSupportedBotLanguages,
  listTradeBotInstances,
  listTradeBotOrders,
  listTradeBots,
  normalizeBotLanguage,
  uploadTradeBotVersion
} from '../services/tradeBotsService.js';
import { recordAudit } from '../services/auditService.js';

const workspaceParamSchema = z.object({
  workspaceId: z.string().uuid()
});

const botParamSchema = z.object({
  workspaceId: z.string().uuid(),
  botId: z.string().min(8)
});

const createBotSchema = z.object({
  name: z.string().min(2).max(100),
  kind: z.enum(['code', 'rule', 'webhook']).optional(),
  description: z.string().max(500).optional()
});

const createBotInstanceSchema = z.object({
  botVersionId: z.string().min(8).optional(),
  exchangeAccountId: z.string().min(8),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/),
  direction: z.enum(['long', 'short', 'both']).default('both'),
  leverage: z.coerce.number().int().min(1).max(250).optional(),
  maxDailyLossPct: z.coerce.number().positive().max(100).optional(),
  takeProfitPct: z.coerce.number().positive().max(100).optional(),
  slAtrMult: z.coerce.number().positive().max(100).optional(),
  useLimitEntries: z.coerce.boolean().optional(),
  minNotional: z.coerce.number().positive().optional(),
  status: z.enum(['running', 'paused', 'error', 'stopped']).optional()
});

const listOrdersQuerySchema = z.object({
  instanceId: z.string().min(8).optional(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/)
    .optional(),
  status: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const monitoringQuerySchema = z.object({
  instanceId: z.string().min(8).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value)
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function ensureUploadFile(file) {
  if (!file) {
    throw Object.assign(new Error('Upload file is required (`file` field)'), { status: 400 });
  }
}

function normalizeUploadPayload(body = {}) {
  const language = normalizeBotLanguage(body.language);
  return {
    language,
    entrypoint: body.entrypoint ? String(body.entrypoint).trim() : null,
    userNotes: body.notes ? String(body.notes).trim() : null,
    autoPublish: parseBool(body.autoPublish, false)
  };
}

export async function handleListTradeBotLanguages(_req, res) {
  res.json({
    items: listSupportedBotLanguages()
  });
}

export async function handleListTradeBots(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params || {});
    const items = await listTradeBots(workspaceId);
    res.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreateTradeBot(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params || {});
    const payload = createBotSchema.parse(req.body || {});
    const created = await createTradeBot(workspaceId, payload);
    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'TRADE_BOT_CREATED',
        entityType: 'Bot',
        entityId: created.id,
        summary: created.name,
        detail: {
          workspaceId,
          kind: created.kind
        }
      });
    } catch {}
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreateTradeBotWithUpload(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params || {});
    ensureUploadFile(req.file);

    const botPayload = createBotSchema.parse({
      name: req.body?.name,
      kind: req.body?.kind || 'code',
      description: req.body?.description
    });
    const uploadPayload = normalizeUploadPayload(req.body || {});

    const createdBot = await createTradeBot(workspaceId, botPayload);
    const upload = await uploadTradeBotVersion({
      workspaceId,
      botId: createdBot.id,
      ...uploadPayload,
      file: req.file
    });

    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'TRADE_BOT_UPLOADED',
        entityType: 'Bot',
        entityId: createdBot.id,
        summary: createdBot.name,
        detail: {
          workspaceId,
          language: upload.version.language,
          status: upload.version.status
        }
      });
    } catch {}

    const refreshed = await getTradeBotDetail(workspaceId, createdBot.id);
    res.status(201).json({
      bot: refreshed,
      upload
    });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleGetTradeBot(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const bot = await getTradeBotDetail(workspaceId, botId);
    res.json(bot);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleUploadTradeBotVersion(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    ensureUploadFile(req.file);
    const uploadPayload = normalizeUploadPayload(req.body || {});
    const upload = await uploadTradeBotVersion({
      workspaceId,
      botId,
      ...uploadPayload,
      file: req.file
    });

    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'TRADE_BOT_VERSION_UPLOADED',
        entityType: 'Bot',
        entityId: botId,
        summary: upload.version.id,
        detail: {
          workspaceId,
          language: upload.version.language,
          status: upload.version.status
        }
      });
    } catch {}

    res.status(201).json(upload);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleListTradeBotInstances(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const items = await listTradeBotInstances(workspaceId, botId);
    res.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreateTradeBotInstance(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const payload = createBotInstanceSchema.parse(req.body || {});
    const instance = await createTradeBotInstance(workspaceId, botId, payload);

    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'TRADE_BOT_INSTANCE_CREATED',
        entityType: 'BotInstance',
        entityId: instance.id,
        summary: `${instance.symbol} ${instance.direction}`,
        detail: {
          workspaceId,
          botId,
          exchangeAccountId: instance.exchangeAccountId
        }
      });
    } catch {}

    res.status(201).json(instance);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleListTradeBotOrders(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const query = listOrdersQuerySchema.parse(req.query || {});
    const result = await listTradeBotOrders(workspaceId, botId, query);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleGetTradeBotMonitoring(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const query = monitoringQuerySchema.parse(req.query || {});
    const result = await getTradeBotMonitoring(workspaceId, botId, query);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleGetTradeBotWorkflowLink(req, res, next) {
  try {
    const { workspaceId, botId } = botParamSchema.parse(req.params || {});
    const workflow = await getTradeBotWorkflowLink(workspaceId, botId);
    res.json(workflow);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}
