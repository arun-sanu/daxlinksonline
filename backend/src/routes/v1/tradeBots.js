import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';
import fs from 'fs';
import path from 'path';
import { queues } from '../../jobs/queues.js';
import { storagePathsForVersion } from '../../builder/build.js';
import multer from 'multer';
import { startInstance as orchStart, stopInstance as orchStop, getLogs as orchLogs, getMetrics as orchMetrics } from '../../lib/orchestrator.js';
import { encrypt } from '../../lib/kms.js';
import { buildPineConversion } from '../../services/pine2py.js';

export const router = Router();
// Zod schemas
const workspaceParam = z.object({ workspaceId: z.string().uuid() });
const botIdParam = z.object({ id: z.string() });
const instanceIdParam = z.object({ id: z.string() });

const createBotBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['webhook', 'code', 'rule']),
  description: z.string().max(2000).optional().nullable()
});

const updateBotBody = z.object({
  name: z.string().min(1).optional(),
  kind: z.enum(['webhook', 'code', 'rule']).optional(),
  description: z.string().max(2000).optional().nullable()
});

const createVersionBody = z.object({
  imageRef: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const createInstanceBody = z.object({
  botVersionId: z.string(),
  exchangeAccountId: z.string(),
  symbol: z.string().min(1),
  direction: z.enum(['long', 'short', 'both']),
  leverage: z.number().int().min(1).max(125).default(1),
  maxDailyLossPct: z.number().min(0).max(100).default(5.0),
  takeProfitPct: z.number().min(0).max(100).default(1.0),
  slAtrMult: z.number().min(0).max(100).default(1.5),
  useLimitEntries: z.boolean().default(true),
  minNotional: z.number().min(0).default(1.0)
});

const updateInstanceBody = createInstanceBody.partial();
const publishBody = z.object({ versionId: z.string().optional() });
const rentBotBody = z.object({ planId: z.string(), exchangeAccountId: z.string(), symbol: z.string().optional().default('BTCUSDT') });
const pineConvertBody = z.object({ pine: z.string().min(1).max(20000) });
const createExchangeAccountBody = z.object({
  name: z.string().min(1),
  venue: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  passphrase: z.string().optional().nullable(),
  isSandbox: z.boolean().optional()
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Scope all routes by workspace
router.post('/pine/convert', requireAuth, async (req, res, next) => {
  try {
    const { pine } = pineConvertBody.parse(req.body || {});
    const { buffer, preview, fallback, warnings } = await buildPineConversion(pine);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="pine-strategy.zip"');
    res.set('X-Strategy-Preview', Buffer.from(preview, 'utf8').toString('base64'));
    res.set('X-Pine-Mode', fallback ? 'webhook' : 'python');
    if (warnings.length) {
      res.set('X-Pine-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    }
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.use('/:workspaceId', requireAuth, workspaceGuard);

function sanitizeExchangeAccount(account) {
  if (!account) return null;
  const { id, workspaceId, name, venue, isSandbox, createdAt, updatedAt } = account;
  return { id, workspaceId, name, venue, isSandbox, createdAt, updatedAt };
}

// POST /:workspaceId/bots
router.post('/:workspaceId/bots', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const body = createBotBody.parse(req.body || {});
    const bot = await prisma.bot.create({
      data: {
        workspaceId,
        name: body.name,
        kind: body.kind,
        description: body.description || null
      }
    });
    res.status(201).json(bot);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/bots
router.get('/:workspaceId/bots', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const bots = await prisma.bot.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' }
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const alerts = await prisma.guardrailEvent.findMany({
      where: { type: 'guardrail_violation', createdAt: { gte: since }, botInstance: { workspaceId } },
      select: { botInstance: { select: { botId: true } } }
    });
    const alertSet = new Set(alerts.map((a) => a.botInstance?.botId).filter(Boolean));
    const items = bots.map((bot) => ({ ...bot, guardrailAlert: alertSet.has(bot.id) }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:botId/versions/:vid/upload
router.post('/:workspaceId/bots/:botId/versions/:vid/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const botId = z.string().parse(req.params.botId);
    const vid = z.string().parse(req.params.vid);
    const version = await prisma.botVersion.findFirst({ where: { id: vid, botId } });
    if (!version) return res.status(404).json({ error: 'Version not found' });
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    let buf = null;
    if (req.file && Buffer.isBuffer(req.file.buffer)) {
      buf = req.file.buffer;
    } else if (req.body?.zipB64) {
      buf = Buffer.from(String(req.body.zipB64), 'base64');
    }
    if (!buf || !buf.length) return res.status(400).json({ error: 'ZIP file required' });
    const { zipPath } = storagePathsForVersion(vid);
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    fs.writeFileSync(zipPath, buf);
    await prisma.botVersion.update({ where: { id: vid }, data: { status: 'draft' } });
    res.status(202).json({ ok: true, bytes: buf.length });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:botId/versions/:vid/build
router.post('/:workspaceId/bots/:botId/versions/:vid/build', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const botId = z.string().parse(req.params.botId);
    const vid = z.string().parse(req.params.vid);
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const version = await prisma.botVersion.findFirst({ where: { id: vid, botId } });
    if (!version) return res.status(404).json({ error: 'Version not found' });
    const { zipPath } = storagePathsForVersion(vid);
    if (!fs.existsSync(zipPath)) return res.status(400).json({ error: 'Upload a ZIP before building' });

    if (process.env.REDIS_URL) {
      await queues.build.add('build', { botId, versionId: vid }, { removeOnComplete: true, removeOnFail: 100 });
    } else {
      const mod = await import('../../jobs/workers/build.worker.js');
      await mod.handleBuildJob({ data: { botId, versionId: vid } });
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/bots/:botId/versions/:vid/scan
router.get('/:workspaceId/bots/:botId/versions/:vid/scan', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const botId = z.string().parse(req.params.botId);
    const vid = z.string().parse(req.params.vid);
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const version = await prisma.botVersion.findFirst({ where: { id: vid, botId } });
    if (!version) return res.status(404).json({ error: 'Version not found' });
    const { scanPath, sbomPath } = storagePathsForVersion(vid);
    const resp = {
      status: version.status,
      imageRef: version.imageRef,
      signedDigest: version.signedDigest,
      sbomRef: version.sbomRef,
      scan: fs.existsSync(scanPath) ? JSON.parse(fs.readFileSync(scanPath, 'utf8')) : null,
      sbom: fs.existsSync(sbomPath) ? JSON.parse(fs.readFileSync(sbomPath, 'utf8')) : null
    };
    res.json(resp);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/bots/:id
router.get('/:workspaceId/bots/:id', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = botIdParam.parse(req.params);
    const bot = await prisma.bot.findFirst({ where: { id, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Not found' });
    res.json(bot);
  } catch (err) {
    next(err);
  }
});

// PATCH /:workspaceId/bots/:id
router.patch('/:workspaceId/bots/:id', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = botIdParam.parse(req.params);
    const patch = updateBotBody.parse(req.body || {});
    const updated = await prisma.bot.update({
      where: { id },
      data: { ...patch },
      select: { id: true, workspaceId: true, name: true, kind: true, description: true, updatedAt: true }
    });
    if (updated.workspaceId !== workspaceId) return res.status(403).json({ error: 'Forbidden' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:id/versions (create draft)
router.post('/:workspaceId/bots/:id/versions', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id: botId } = botIdParam.parse(req.params);
    const body = createVersionBody.parse(req.body || {});
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const version = await prisma.botVersion.create({
      data: {
        botId,
        imageRef: body.imageRef || null,
        notes: body.notes || null,
        status: 'draft'
      }
    });
    res.status(201).json(version);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/bots/:id/versions
router.get('/:workspaceId/bots/:id/versions', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id: botId } = botIdParam.parse(req.params);
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const versions = await prisma.botVersion.findMany({ where: { botId }, orderBy: { createdAt: 'desc' } });
    res.json({ items: versions });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:id/publish
router.post('/:workspaceId/bots/:id/publish', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id: botId } = botIdParam.parse(req.params);
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const body = publishBody.parse(req.body || {});
    let target = null;
    if (body.versionId) {
      target = await prisma.botVersion.findFirst({
        where: { id: body.versionId, botId, status: { in: ['approved', 'published'] } }
      });
      if (!target) return res.status(400).json({ error: 'Version not approved' });
    } else {
      target = await prisma.botVersion.findFirst({
        where: { botId, status: { in: ['approved', 'published'] } },
        orderBy: { createdAt: 'desc' }
      });
      if (!target) return res.status(400).json({ error: 'No approved version to publish' });
    }

    const [, , updatedBot] = await prisma.$transaction([
      prisma.botVersion.update({ where: { id: target.id }, data: { status: 'published' } }),
      prisma.botVersion.updateMany({
        where: { botId, NOT: { id: target.id }, status: 'published' },
        data: { status: 'approved' }
      }),
      prisma.bot.update({ where: { id: botId }, data: { latestVersionId: target.id } })
    ]);
    res.json({ ok: true, latestVersionId: updatedBot.latestVersionId });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:botId/instances
router.post('/:workspaceId/bots/:botId/instances', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const botId = z.string().parse(req.params.botId);
    const body = createInstanceBody.parse(req.body || {});
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const version = await prisma.botVersion.findFirst({ where: { id: body.botVersionId, botId } });
    if (!version) return res.status(400).json({ error: 'Invalid botVersionId' });
    const instance = await prisma.botInstance.create({
      data: {
        botId,
        botVersionId: body.botVersionId,
        workspaceId,
        exchangeAccountId: body.exchangeAccountId,
        symbol: body.symbol,
        direction: body.direction,
        leverage: body.leverage,
        maxDailyLossPct: body.maxDailyLossPct,
        takeProfitPct: body.takeProfitPct,
        slAtrMult: body.slAtrMult,
        useLimitEntries: body.useLimitEntries,
        minNotional: body.minNotional
      }
    });
    res.status(201).json(instance);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/bots/:botId/instances
router.get('/:workspaceId/bots/:botId/instances', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const botId = z.string().parse(req.params.botId);
    const bot = await prisma.bot.findFirst({ where: { id: botId, workspaceId } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    const items = await prisma.botInstance.findMany({ where: { botId, workspaceId }, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/instances/:id
router.get('/:workspaceId/instances/:id', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    res.json(inst);
  } catch (err) {
    next(err);
  }
});

// PATCH /:workspaceId/instances/:id
router.patch('/:workspaceId/instances/:id', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const patch = updateInstanceBody.parse(req.body || {});
    const updated = await prisma.botInstance.update({ where: { id }, data: { ...patch } });
    if (updated.workspaceId !== workspaceId) return res.status(403).json({ error: 'Forbidden' });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/exchange-accounts
router.post('/:workspaceId/exchange-accounts', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const body = createExchangeAccountBody.parse(req.body || {});
    const encKey = encrypt(body.apiKey);
    const encSecret = encrypt(body.apiSecret);
    const encPass = body.passphrase ? encrypt(body.passphrase) : null;
    const created = await prisma.exchangeAccount.create({
      data: {
        workspaceId,
        name: body.name,
        venue: body.venue,
        apiKeyEnc: Buffer.from(encKey.data).toString('base64'),
        apiSecretEnc: Buffer.from(encSecret.data).toString('base64'),
        passphraseEnc: encPass ? Buffer.from(encPass.data).toString('base64') : null,
        isSandbox: body.isSandbox ?? false
      }
    });
    res.status(201).json(sanitizeExchangeAccount(created));
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/exchange-accounts
router.get('/:workspaceId/exchange-accounts', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const venue = req.query.venue ? String(req.query.venue) : undefined;
    const where = { workspaceId };
    if (venue) where.venue = venue;
    const items = await prisma.exchangeAccount.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ items: items.map(sanitizeExchangeAccount) });
  } catch (err) {
    next(err);
  }
});

// DELETE /:workspaceId/exchange-accounts/:id
router.delete('/:workspaceId/exchange-accounts/:id', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const id = z.string().parse(req.params.id);
    const existing = await prisma.exchangeAccount.findFirst({ where: { id, workspaceId } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await prisma.exchangeAccount.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/bots/:id/rent
router.post('/:workspaceId/bots/:id/rent', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id: botId } = botIdParam.parse(req.params);
    const body = rentBotBody.parse(req.body || {});
    const bot = await prisma.bot.findFirst({ where: { id: botId }, include: { workspace: true } });
    if (!bot) return res.status(404).json({ error: 'Bot not found' });
    if (bot.workspaceId === workspaceId) return res.status(400).json({ error: 'Cannot rent own bot' });
    const publishedVersion = await prisma.botVersion.findFirst({ where: { botId, status: 'published' }, orderBy: { createdAt: 'desc' } });
    if (!publishedVersion) return res.status(403).json({ error: 'Bot not published' });
    const plan = await prisma.plan.findFirst({ where: { id: body.planId, workspaceId: bot.workspaceId, active: true } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    const exchange = await prisma.exchangeAccount.findFirst({ where: { id: body.exchangeAccountId, workspaceId } });
    if (!exchange) return res.status(404).json({ error: 'Exchange account not found' });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const signature = `rental-${botId}-${Date.now()}`;
    const { rental, instance } = await prisma.$transaction(async (tx) => {
      const createdRental = await tx.rental.create({
        data: {
          botId,
          renterWorkspaceId: workspaceId,
          planId: plan.id,
          exchangeAccountId: exchange.id,
          expiresAt
        }
      });
      const createdInstance = await tx.botInstance.create({
        data: {
          botId,
          botVersionId: publishedVersion.id,
          workspaceId,
          exchangeAccountId: exchange.id,
          symbol: body.symbol || 'BTCUSDT',
          direction: 'both',
          leverage: 1,
          maxDailyLossPct: 5,
          takeProfitPct: 1,
          slAtrMult: 1.5,
          useLimitEntries: true,
          minNotional: 1,
          status: 'stopped',
          webhookToken: signature
        }
      });
      await tx.rental.update({ where: { id: createdRental.id }, data: { botInstanceId: createdInstance.id } });
      return { rental: createdRental, instance: createdInstance };
    });
    res.status(201).json({ rentalId: rental.id, instanceId: instance.id });
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/rentals
router.get('/:workspaceId/rentals', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const items = await prisma.rental.findMany({
      where: { renterWorkspaceId: workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        bot: true,
        plan: true,
        exchangeAccount: true,
        instance: true
      }
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// GET /market published bots
router.get('/:workspaceId/market', async (req, res, next) => {
  try {
    const bots = await prisma.bot.findMany({
      where: { versions: { some: { status: 'published' } } },
      include: {
        workspace: { select: { id: true, name: true } },
        versions: { where: { status: 'published' }, orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'desc' }
    });
    const workspaceIds = [...new Set(bots.map((bot) => bot.workspaceId))];
    const plans = await prisma.plan.findMany({ where: { workspaceId: { in: workspaceIds }, active: true } });
    const plansByWorkspace = plans.reduce((acc, plan) => {
      if (!acc[plan.workspaceId]) acc[plan.workspaceId] = [];
      acc[plan.workspaceId].push(plan);
      return acc;
    }, {});
    const items = bots
      .filter((bot) => bot.versions.length)
      .map((bot) => ({
        id: bot.id,
        name: bot.name,
        description: bot.description,
        workspace: bot.workspace,
        publishedAt: bot.versions[0]?.createdAt,
        updatedAt: bot.updatedAt,
        versionId: bot.versions[0]?.id,
        plans: (plansByWorkspace[bot.workspaceId] || []).map((plan) => ({
          id: plan.id,
          workspaceId: plan.workspaceId,
          name: plan.name,
          cpuMilli: plan.cpuMilli,
          memMiB: plan.memMiB,
          priceMonthly: plan.priceMonthly,
          active: plan.active
        }))
      }));
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/instances/:id/start
router.post('/:workspaceId/instances/:id/start', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId }, include: { botVersion: true } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    // Orchestrate start
    const imageRef = inst.botVersion?.imageRef || 'local/mock-image';
    await orchStart({ instanceId: id, imageRef, cpuMilli: 250, memMiB: 256 });
    const updated = await prisma.botInstance.update({ where: { id }, data: { status: 'running', startedAt: new Date(), stoppedAt: null } });
    await prisma.botRun.create({ data: { botInstanceId: id, status: 'running' } });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /:workspaceId/instances/:id/stop
router.post('/:workspaceId/instances/:id/stop', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    await orchStop(id);
    const updated = await prisma.botInstance.update({ where: { id }, data: { status: 'stopped', stoppedAt: new Date() } });
    // Mark latest running run as finished
    const lastRun = await prisma.botRun.findFirst({ where: { botInstanceId: id, status: 'running' }, orderBy: { startedAt: 'desc' } });
    if (lastRun) {
      await prisma.botRun.update({ where: { id: lastRun.id }, data: { status: 'success', finishedAt: new Date() } });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/instances/:id/orders|positions|runs|logs
router.get('/:workspaceId/instances/:id/orders', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const items = await prisma.order.findMany({ where: { botInstanceId: id }, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:workspaceId/instances/:id/positions', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const items = await prisma.position.findMany({ where: { botInstanceId: id }, orderBy: { openedAt: 'desc' } });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:workspaceId/instances/:id/runs', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const items = await prisma.botRun.findMany({ where: { botInstanceId: id }, orderBy: { startedAt: 'desc' } });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

router.get('/:workspaceId/instances/:id/logs', async (req, res, next) => {
  try {
    // Placeholder: logs may come from an external store later
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const tail = Number(req.query.tail || 100);
    const out = await orchLogs(id, tail);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// GET /:workspaceId/instances/:id/metrics
router.get('/:workspaceId/instances/:id/metrics', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const win = String(req.query.window || '5m');
    const out = await orchMetrics(id, win);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:workspaceId/instances/:id/security', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const events = await prisma.guardrailEvent.findMany({
      where: { botInstanceId: id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const findEvent = (type) => events.find((evt) => evt.type === type);
    const response = {
      rateLimit: {
        lastTriggeredAt: findEvent('rate_limit')?.createdAt || null,
        detail: findEvent('rate_limit')?.detail || null
      },
      signature: {
        lastCheckAt: findEvent('signature_ok')?.createdAt || null,
        lastFailureAt: findEvent('signature_fail')?.createdAt || null
      },
      guardrail: {
        lastTriggeredAt: findEvent('guardrail_violation')?.createdAt || null,
        detail: findEvent('guardrail_violation')?.detail || null
      }
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// Optional: signals list for UI count/polling
router.get('/:workspaceId/instances/:id/signals', async (req, res, next) => {
  try {
    const { workspaceId } = workspaceParam.parse(req.params);
    const { id } = instanceIdParam.parse(req.params);
    const inst = await prisma.botInstance.findFirst({ where: { id, workspaceId } });
    if (!inst) return res.status(404).json({ error: 'Not found' });
    const items = await prisma.signal.findMany({ where: { botInstanceId: id }, orderBy: { receivedAt: 'desc' }, take: 50 });
    res.json({ items });
  } catch (err) {
    next(err);
  }
});
