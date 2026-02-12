import crypto from 'crypto';
import { z } from 'zod';

import { prisma } from '../utils/prisma.js';
import { forward } from '../services/tradingviewService.js';
import { extractSubdomain } from '../lib/webhookDomains.js';
import { webhookConfig } from '../config/webhook.js';
import { createTradingviewAlert, updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import { getWebhookHmacPolicy } from '../services/webhookPolicy.js';
import {
  EXECUTION_AUDIT_STATUS,
  buildExecutionDedupeKey,
  createExecutionAudit,
  findDuplicateExecutionAudit,
  updateExecutionAudit
} from '../services/executionAuditService.js';
import { normalizeTradingviewSignal } from '../services/tradingviewSignalService.js';

const payloadSchema = z.object({
  secret: z.string().optional()
}).passthrough();

const HMAC_FIELDS = new Set(['hmac', 'signature', 'sign']);
const DEBUG_TV_WEBHOOK = String(process.env.DEBUG_TV_WEBHOOK || 'false').toLowerCase() === 'true';

function maybeRedactSnippet(value) {
  return String(value || '')
    .replace(/(\"secret\"\s*:\s*\")([^\"]+)(\")/gi, '$1[redacted]$3')
    .replace(/(\"hmac\"\s*:\s*\")([^\"]+)(\")/gi, '$1[redacted]$3')
    .replace(/(\"signature\"\s*:\s*\")([^\"]+)(\")/gi, '$1[redacted]$3')
    .replace(/(\"sign\"\s*:\s*\")([^\"]+)(\")/gi, '$1[redacted]$3');
}

function debugWebhook(stage, data = {}) {
  if (!DEBUG_TV_WEBHOOK) return;
  const safe = { stage, ...data };
  try {
    console.log('[tv-webhook-debug]', JSON.stringify(safe));
  } catch {
    console.log('[tv-webhook-debug]', stage);
  }
}

function parseJsonObject(text) {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Webhook body is not a JSON string' };
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Webhook JSON body must be an object' };
    }
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: 'Unable to parse webhook JSON body' };
  }
}

async function findUserByPrefix(prefix) {
  if (!prefix) return null;
  const record = await prisma.dnsRecord.findFirst({
    where: { subdomain: prefix, status: 'active' },
    select: { userId: true }
  });
  if (!record) return null;
  return prisma.user.findUnique({ where: { id: record.userId } });
}

async function resolveSingleExecutionTarget(userId) {
  if (!userId) return null;
  const rows = await prisma.integration.findMany({
    where: {
      workspace: { ownerId: userId },
      exchange: { equals: 'mexc', mode: 'insensitive' },
      credential: { isNot: null },
      status: { in: ['active', 'pending', 'connected'] }
    },
    select: {
      id: true,
      workspaceId: true
    },
    orderBy: { updatedAt: 'desc' },
    take: 2
  });
  if (rows.length !== 1) return null;
  return {
    botId: rows[0].id,
    integrationId: rows[0].id,
    workspaceId: rows[0].workspaceId
  };
}

function toRawText(req) {
  if (typeof req.rawBodyText === 'string') return req.rawBodyText;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  return '';
}

function validateUserStatus(user) {
  if (user.isActive === false) {
    const err = new Error('Account inactive');
    err.status = 410;
    throw err;
  }
  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    const err = new Error('Trial expired');
    err.status = 410;
    throw err;
  }
}

function resolveSecret(req, { requireQuerySecret, allowBodySecret }) {
  const querySecret = typeof req.query?.secret === 'string' ? req.query.secret : null;
  const bodySecret = allowBodySecret && typeof req.body?.secret === 'string' ? req.body.secret : null;
  const supplied = querySecret || bodySecret || null;
  if (!supplied && requireQuerySecret) {
    const err = new Error('secret query param required');
    err.status = 401;
    throw err;
  }
  return supplied;
}

function extractTimestamp(req) {
  const candidates = [
    req.headers['x-tv-timestamp'],
    req.query?.timestamp,
    req.body?.timestamp,
    req.body?.ts,
    req.query?.ts
  ].filter(Boolean);
  if (!candidates.length) return null;
  const raw = candidates[0];
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
    const num = Number(raw);
    if (Number.isFinite(num)) {
      return num < 1e12 ? num * 1000 : num;
    }
  }
  return NaN;
}

function verifyTimestamp(ts) {
  if (!ts) return { ok: true };
  if (Number.isNaN(ts)) {
    return { ok: false, message: 'Invalid timestamp' };
  }
  const skew = Math.abs(Date.now() - ts);
  const maxSkewMs = webhookConfig.maxSkewMs;
  if (skew > maxSkewMs) {
    return { ok: false, message: 'Replay detected: timestamp outside allowed window' };
  }
  return { ok: true };
}

function deepStripHmacFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepStripHmacFields(entry));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((key) => !HMAC_FIELDS.has(key))
      .sort()
      .reduce((acc, key) => {
        acc[key] = deepStripHmacFields(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function resolveHmacSource(req, payload) {
  const primary = ['message', 'text', 'signal', 'body'].find(
    (key) => typeof payload?.[key] === 'string' && payload[key].length > 0
  );
  if (primary) {
    return Buffer.from(String(payload[primary]), 'utf8');
  }
  const canonical = deepStripHmacFields(payload || {});
  const json = JSON.stringify(canonical);
  if (json && json !== '{}') {
    return Buffer.from(json, 'utf8');
  }
  if (req.rawBody && req.rawBody.length > 0) return req.rawBody;
  return Buffer.from('');
}

function verifyHmac({ provided, key, payloadBuffer }) {
  if (!provided || !key) return { ok: false, message: 'Missing signature' };
  try {
    const computedHex = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(payloadBuffer).digest('hex');
    const expectedBuf = Buffer.from(computedHex, 'hex');
    const incoming = String(provided).trim();
    const providedBuf = Buffer.from(incoming, 'hex');
    if (expectedBuf.length !== providedBuf.length) {
      return { ok: false, message: 'Invalid signature' };
    }
    const matches = crypto.timingSafeEqual(expectedBuf, providedBuf);
    return matches ? { ok: true } : { ok: false, message: 'Invalid signature' };
  } catch (error) {
    return { ok: false, message: error.message || 'HMAC verification failed' };
  }
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.length > 0) return cfIp;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const head = xff.split(',')[0];
    if (head) return head.trim();
  }
  return req.ip || req.connection?.remoteAddress || '';
}

function logReject(reason, context = {}) {
  console.warn(
    JSON.stringify({
      event: 'tradingview_webhook_reject',
      at: new Date().toISOString(),
      reason,
      ...context
    })
  );
}

export function createTradingviewWebhookHandler(
  { requireQuerySecret = false, allowBodySecret = true } = {},
  deps = {}
) {
  const {
    findUser = findUserByPrefix,
    forwarder = forward,
    resolveExecutionTarget = resolveSingleExecutionTarget,
    getHmacPolicy = getWebhookHmacPolicy,
    createAudit = createExecutionAudit,
    updateAudit = updateExecutionAudit,
    findDuplicateAudit = findDuplicateExecutionAudit
  } = deps;
  return async function tradingviewWebhookHandler(req, res, next) {
    let alertRecord = null;
    let executionAudit = null;
    try {
      const clientIp = getClientIp(req);
      let prefix = req.subdomainPrefix;
      if (!prefix) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        prefix = extractSubdomain(host);
      }
      if (!prefix) {
        logReject('invalid_host', { ip: clientIp });
        return res.status(400).json({ error: 'Invalid host header' });
      }

      const user = await findUser(prefix);
      if (!user) {
        logReject('user_not_found', { prefix, ip: clientIp });
        return res.status(404).json({ error: 'Not found' });
      }
      try {
        validateUserStatus(user);
      } catch (statusErr) {
        logReject(statusErr.message || 'user_inactive', {
          prefix,
          userId: user.id,
          ip: clientIp
        });
        return res.status(statusErr.status || 500).json({ error: statusErr.message });
      }

      const rawBody = toRawText(req);
      const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
      let inboundPayload = null;
      let inboundParseError = null;

      if (req.body && typeof req.body === 'object' && !Array.isArray(req.body) && !Buffer.isBuffer(req.body)) {
        inboundPayload = { ...req.body };
      } else if (typeof req.body === 'string') {
        const parsed = parseJsonObject(req.body);
        if (parsed.ok) {
          inboundPayload = parsed.value;
        } else {
          inboundParseError = parsed.error;
        }
      } else if (rawBody) {
        const parsed = parseJsonObject(rawBody);
        if (parsed.ok) {
          inboundPayload = parsed.value;
        } else {
          inboundParseError = parsed.error;
        }
      }
      if (!inboundPayload) {
        inboundPayload = {};
      }

      debugWebhook('ingress', {
        contentType,
        bodyType: typeof req.body,
        rawPreview:
          typeof rawBody === 'string' && rawBody.length > 0 ? maybeRedactSnippet(rawBody.slice(0, 200)) : null,
        bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 20) : []
      });

      const candidatePayload = { ...inboundPayload };
      if (!candidatePayload.source) {
        candidatePayload.source = 'tradingview';
      }
      if (!candidatePayload.sourceId && !candidatePayload.webhookId && prefix) {
        candidatePayload.sourceId = `tv:${prefix}`;
      }
      const normalizedSignal = normalizeTradingviewSignal(candidatePayload);

      try {
        alertRecord = await createTradingviewAlert({
          userId: user.id,
          payload: normalizedSignal.normalizedPayload || candidatePayload,
          status: 'received',
          webhookSubdomain: prefix,
          clientIp
        });
      } catch (err) {
        console.warn('[tradingview] failed to record alert', err?.message || err);
      }
      try {
        executionAudit = await createAudit({
          userId: user.id,
          tradingviewAlertId: alertRecord?.id || null,
          tvTs: normalizedSignal?.signal?.ts || candidatePayload.ts || candidatePayload.timestamp || null,
          symbol: normalizedSignal?.signal?.symbol || candidatePayload.symbol || null,
          side: normalizedSignal?.signal?.side || candidatePayload.side || null,
          rawBody,
          parsedPayload: normalizedSignal.normalizedPayload || candidatePayload,
          status: EXECUTION_AUDIT_STATUS.RECEIVED
        });
        debugWebhook('audit_created', {
          auditId: executionAudit?.id || null,
          status: executionAudit?.status || EXECUTION_AUDIT_STATUS.RECEIVED
        });
      } catch (err) {
        console.warn('[tradingview] failed to create execution audit', err?.message || err);
      }

      const safeUpdateAlert = async (status, message = null) => {
        if (!alertRecord) return;
        try {
          await updateTradingviewAlertStatus(alertRecord.id, status, message);
        } catch (err) {
          console.warn('[tradingview] failed to update alert status', err?.message || err);
        }
      };
      const safeUpdateExecutionAudit = async (patch = {}) => {
        if (!executionAudit?.id) return;
        try {
          executionAudit = await updateAudit(executionAudit.id, patch);
        } catch (err) {
          console.warn('[tradingview] failed to update execution audit', err?.message || err);
        }
      };
      const rejectInbound = async ({ statusCode, reason, reasonKey = 'invalid_payload' }) => {
        logReject(reasonKey, { prefix, userId: user.id, ip: clientIp });
        await safeUpdateAlert('rejected', reason);
        await safeUpdateExecutionAudit({
          status: EXECUTION_AUDIT_STATUS.REJECTED,
          errorMessage: reason
        });
        debugWebhook('audit_updated', {
          auditId: executionAudit?.id || null,
          status: EXECUTION_AUDIT_STATUS.REJECTED,
          reason
        });
        return res.status(statusCode).json({ error: reason });
      };

      await safeUpdateExecutionAudit({
        symbol: normalizedSignal?.signal?.symbol || candidatePayload.symbol || null,
        side: normalizedSignal?.signal?.side || candidatePayload.side || null,
        tvTs: normalizedSignal?.signal?.ts || candidatePayload.ts || candidatePayload.timestamp || null,
        parsedPayload: normalizedSignal.normalizedPayload || candidatePayload,
        rawBody
      });
      debugWebhook('normalized', {
        auditId: executionAudit?.id || null,
        status: executionAudit?.status || EXECUTION_AUDIT_STATUS.RECEIVED,
        symbol: normalizedSignal?.signal?.symbol || null,
        side: normalizedSignal?.signal?.side || null,
        tvTs: normalizedSignal?.signal?.ts || null
      });

      const expectedSecret = user.webhookSecret;
      if (expectedSecret) {
        try {
          const providedSecret = resolveSecret(req, { requireQuerySecret, allowBodySecret });
          if (!providedSecret) {
            return rejectInbound({
              statusCode: 401,
              reason: 'Secret required',
              reasonKey: 'secret_missing'
            });
          }
          if (providedSecret !== expectedSecret) {
            return rejectInbound({
              statusCode: 401,
              reason: 'Invalid secret',
              reasonKey: 'secret_invalid'
            });
          }
        } catch (secretErr) {
          logReject(secretErr.message || 'secret_error', { prefix, userId: user.id, ip: clientIp });
          await safeUpdateAlert('rejected', secretErr.message || 'Secret error');
          await safeUpdateExecutionAudit({
            status: EXECUTION_AUDIT_STATUS.REJECTED,
            errorMessage: secretErr.message || 'Secret error'
          });
          return res.status(secretErr.status || 401).json({ error: secretErr.message });
        }
      }

      const timestamp = extractTimestamp(req);
      const tsStatus = verifyTimestamp(timestamp);
      if (!tsStatus.ok) {
        return rejectInbound({
          statusCode: 403,
          reason: tsStatus.message,
          reasonKey: 'timestamp_invalid'
        });
      }

      const expectedHmacKey = user.webhookHmacKey;
      const providedHmac = inboundPayload.hmac || inboundPayload.signature || inboundPayload.sign;
      const policy = await getHmacPolicy();
      const disableTradingview = Boolean(policy.disableTradingview);
      const hmacEnforced = Boolean(policy.enforceGlobal) && !disableTradingview;
      if (expectedHmacKey && providedHmac) {
        const payloadBuffer = resolveHmacSource(req, inboundPayload);
        const result = verifyHmac({ provided: String(providedHmac), key: expectedHmacKey, payloadBuffer });
        if (!result.ok) {
          return rejectInbound({
            statusCode: 401,
            reason: result.message,
            reasonKey: 'hmac_invalid'
          });
        }
      } else if (expectedHmacKey && hmacEnforced) {
        return rejectInbound({
          statusCode: 401,
          reason: 'Missing HMAC signature',
          reasonKey: 'hmac_missing'
        });
      }

      if (inboundParseError) {
        return rejectInbound({
          statusCode: 200,
          reason: inboundParseError,
          reasonKey: 'payload_parse_failed'
        });
      }

      if (!normalizedSignal.ok) {
        return rejectInbound({
          statusCode: 422,
          reason: normalizedSignal.errors.join('; '),
          reasonKey: 'payload_validation_failed'
        });
      }

      const signal = normalizedSignal.signal;
      const executionTarget = await resolveExecutionTarget(user.id);
      let dedupeKey = null;
      if (executionTarget?.botId && signal?.ts) {
        dedupeKey = buildExecutionDedupeKey({
          symbol: signal.symbol,
          side: signal.side,
          tvTs: signal.ts,
          botId: executionTarget.botId
        });
        await safeUpdateExecutionAudit({
          workspaceId: executionTarget.workspaceId,
          botId: executionTarget.botId,
          integrationId: executionTarget.integrationId,
          symbol: signal.symbol,
          side: signal.side,
          tvTs: signal.ts,
          dedupeKey,
          parsedPayload: normalizedSignal.normalizedPayload
        });
        const duplicate = await findDuplicateAudit({
          botId: executionTarget.botId,
          dedupeKey,
          excludeId: executionAudit?.id || null
        });
        if (duplicate) {
          await safeUpdateAlert('rejected', 'duplicate');
          await safeUpdateExecutionAudit({
            status: EXECUTION_AUDIT_STATUS.REJECTED,
            errorMessage: 'duplicate'
          });
          return res.status(200).json({ ok: true, message: 'duplicate' });
        }
      } else {
        await safeUpdateExecutionAudit({
          symbol: signal.symbol,
          side: signal.side,
          tvTs: signal.ts,
          parsedPayload: normalizedSignal.normalizedPayload
        });
      }

      const payload = payloadSchema.parse({
        ...(normalizedSignal.normalizedPayload || candidatePayload || {}),
        source: 'tradingview',
        sourceId: candidatePayload.sourceId,
        symbol: signal.symbol,
        side: signal.side,
        type: 'market',
        ts: signal.ts,
        executionAuditId: executionAudit?.id || null,
        dedupeKey: dedupeKey || null,
        workspaceId: executionTarget?.workspaceId || null,
        botId: executionTarget?.botId || null
      });

      await safeUpdateAlert('validated', null);
      debugWebhook('queued', {
        auditId: executionAudit?.id || null,
        status: executionAudit?.status || EXECUTION_AUDIT_STATUS.RECEIVED
      });
      forwarder(user.id, payload, { alertId: alertRecord?.id, executionAuditId: executionAudit?.id })
        .catch(async (err) => {
          const message = err?.message || 'Forward enqueue failed';
          console.warn('[tradingview] forward failed', err);
          await safeUpdateAlert('failed', message);
          await safeUpdateExecutionAudit({
            status: EXECUTION_AUDIT_STATUS.ERROR,
            errorMessage: message
          });
          debugWebhook('audit_updated', {
            auditId: executionAudit?.id || null,
            status: EXECUTION_AUDIT_STATUS.ERROR,
            reason: message
          });
        });
      return res.status(200).json({ ok: true, message: 'queued' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.status = 400;
      }
      next(error);
    }
  };
}
