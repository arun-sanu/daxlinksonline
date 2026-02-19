import { prisma } from '../utils/prisma.js';
import { normalizePayload, computeIdempotencyKey } from '../services/forwardingMapper.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import crypto from 'crypto';
import { getWorkspaceWorkflowConfig, simulateRules } from '../services/workflowService.js';
import { initExecuteOrdersQueue, executeOrdersQueue } from './queue.js';
import {
  EXECUTION_AUDIT_STATUS,
  buildExecutionDedupeKey,
  findDuplicateExecutionAudit,
  updateExecutionAudit
} from '../services/executionAuditService.js';
import { normalizeSignalTimestamp } from '../services/tradingviewSignalService.js';

export async function processForwardJob(job) {
  const { userId, payload, alertId, executionAuditId } = job.data || {};
  if (!userId) return;
  try {
    const normalizedInput = normalizePayload(payload);
    const normalized = {
      ...normalizedInput,
      type: normalizedInput.type || 'market'
    };
    const tvTs = normalizeSignalTimestamp(payload?.ts ?? payload?.timestamp ?? payload?.time);
    const idemKey = computeIdempotencyKey({ userId, normalized });
    const notional = normalized.amount && normalized.price ? normalized.amount * normalized.price : normalized.amount || 0;

    const workspaces = await prisma.workspace.findMany({
      where: { ownerId: userId },
      select: { id: true }
    });
    const workspaceIds = workspaces.map((w) => w.id);
    if (workspaceIds.length === 0) {
      if (alertId) {
        await updateTradingviewAlertStatus(alertId, 'failed', 'No workspace configured');
      }
      return;
    }

    const executionTargets = [];
    for (const workspaceId of workspaceIds) {
      const config = await getWorkspaceWorkflowConfig(workspaceId);
      const workflowStatus = String(config?.status || 'active').toLowerCase();
      if (workflowStatus === 'paused') {
        console.log(`[forwarder] Workflow paused for workspace ${workspaceId}; skipping routing`);
        continue;
      }
      const source = { id: payload?.webhookId || payload?.sourceId || payload?.source || 'unknown' };
      const signal = { symbol: normalized.symbol, side: normalized.side, notional, amount: normalized.amount };
      const simulation = await simulateRules({
        workspaceId,
        rules: config.rules || [],
        source,
        signal,
        workflowStatus: config.status
      });
      if (simulation.matchedRules.length > 0) {
        executionTargets.push(...simulation.matchedRules.map((rule) => ({ ...rule, workspaceId })));
        continue;
      }

      const autoTargets = await resolveAutoExecutionTargets({ workspaceId, normalized });
      if (autoTargets.length > 0) {
        console.log(
          `[forwarder] Auto-routed signal for workspace ${workspaceId} to integration ${autoTargets[0].destinationIntegrationId}`
        );
        executionTargets.push(...autoTargets.map((target) => ({ ...target, workspaceId })));
      }
    }

    if (!executionTargets.length) {
      console.log('[forwarder] No matching routing rules — signal ignored');
      await upsertForwardedSignal({
        userId,
        integrationId: null,
        idempotencyKey: idemKey,
        normalized,
        status: 'skipped_no_rule',
        attempts: 1,
        error: 'No matching routing rules'
      });
      if (alertId) {
        await updateTradingviewAlertStatus(alertId, 'failed', 'No matching routing rules');
      }
      if (executionAuditId) {
        await updateExecutionAudit(executionAuditId, {
          status: EXECUTION_AUDIT_STATUS.REJECTED,
          errorMessage: 'No matching routing rules'
        });
      }
      return;
    }

    let scheduledCount = 0;
    for (const target of executionTargets) {
      const botId = target.destinationIntegrationId || null;
      const dedupeKey = buildExecutionDedupeKey({
        symbol: normalized.symbol,
        side: normalized.side,
        tvTs,
        botId
      });

      if (executionAuditId) {
        await updateExecutionAudit(executionAuditId, {
          workspaceId: target.workspaceId || null,
          integrationId: botId,
          botId,
          dedupeKey,
          symbol: normalized.symbol || null,
          side: normalized.side || null,
          tvTs
        });
      }

      if (dedupeKey && botId) {
        const duplicate = await findDuplicateExecutionAudit({
          botId,
          dedupeKey,
          excludeId: executionAuditId || null
        });
        if (duplicate) {
          if (executionAuditId) {
            await updateExecutionAudit(executionAuditId, {
              status: EXECUTION_AUDIT_STATUS.REJECTED,
              errorMessage: 'duplicate'
            });
          }
          if (alertId) {
            await updateTradingviewAlertStatus(alertId, 'rejected', 'duplicate');
          }
          continue;
        }
      }

      const scopedIdempotencyKey = buildTargetIdempotencyKey({
        idempotencyKey: idemKey,
        integrationId: botId,
        ruleId: target.ruleId || dedupeKey || 'signal'
      });
      const augmented = {
        ...normalized,
        raw: {
          ...(normalized.raw || {}),
          alertId: alertId || null,
          executionAuditId: executionAuditId || null,
          workspaceId: target.workspaceId || null,
          botId,
          dedupeKey,
          ts: tvTs,
          mappedOrder: target.mappedOrder,
          ruleId: target.ruleId
        }
      };
      const record = await upsertForwardedSignal({
        userId,
        integrationId: botId,
        idempotencyKey: scopedIdempotencyKey,
        normalized: augmented,
        status: 'ready_for_execution',
        attempts: 0,
        error: null
      });
      if (executionAuditId) {
        await updateExecutionAudit(executionAuditId, {
          forwardedSignalId: record.id
        });
      }
      if (!executeOrdersQueue) {
        initExecuteOrdersQueue();
      }
      if (executeOrdersQueue) {
        await executeOrdersQueue.add('execute-prepared-signal', { signalId: record.id });
      }
      scheduledCount += 1;
    }

    if (scheduledCount === 0) {
      if (executionAuditId) {
        await updateExecutionAudit(executionAuditId, {
          status: EXECUTION_AUDIT_STATUS.REJECTED,
          errorMessage: 'duplicate'
        });
      }
      return;
    }

    console.log(`[forwarder] Signal routed to ${scheduledCount} integration(s) using workflow rules`);
  } catch (err) {
    if (alertId) {
      try {
        await updateTradingviewAlertStatus(alertId, 'failed', err?.message || 'Forwarding failed');
      } catch {}
    }
    if (executionAuditId) {
      try {
        await updateExecutionAudit(executionAuditId, {
          status: EXECUTION_AUDIT_STATUS.ERROR,
          errorMessage: err?.message || 'Forwarding failed'
        });
      } catch {}
    }
    throw err;
  }
}

const AUTO_ROUTE_SINGLE_INTEGRATION =
  String(process.env.TRADINGVIEW_AUTO_ROUTE_SINGLE_INTEGRATION || 'true').toLowerCase() === 'true';

function buildTargetIdempotencyKey({ idempotencyKey, integrationId, ruleId }) {
  return crypto
    .createHash('sha256')
    .update(`${idempotencyKey}:${integrationId || 'none'}:${ruleId || 'none'}`)
    .digest('hex');
}

async function resolveAutoExecutionTargets({ workspaceId, normalized }) {
  if (!AUTO_ROUTE_SINGLE_INTEGRATION) return [];
  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId,
      credentials: { some: {} },
      status: { in: ['active', 'pending', 'connected'] }
    },
    select: {
      id: true,
      exchange: true
    },
    orderBy: { updatedAt: 'desc' }
  });
  if (!integrations.length) return [];

  const requestedExchange = normalized.exchange ? String(normalized.exchange).toLowerCase() : null;
  const candidates = requestedExchange
    ? integrations.filter((integration) => String(integration.exchange || '').toLowerCase() === requestedExchange)
    : integrations;
  if (candidates.length !== 1) return [];

  const target = candidates[0];
  return [
    {
      ruleId: 'auto-single-integration',
      destinationIntegrationId: target.id,
      mappedOrder: {
        orderType: normalized.type || 'market',
        size: normalized.amount ?? null,
        leverage: 1
      }
    }
  ];
}

async function upsertForwardedSignal({ userId, integrationId, idempotencyKey, normalized, status, attempts, error }) {
  const base = {
    userId,
    integrationId,
    idempotencyKey,
    symbol: normalized.symbol || null,
    side: normalized.side || null,
    type: normalized.type || null,
    amount: normalized.amount ?? null,
    price: normalized.price ?? null,
    payload: normalizeForStorage(normalized.raw),
    status,
    attempts,
    error: error || null,
    executedAt: new Date()
  };
  try {
    const existing = await prisma.forwardedSignal.findUnique({ where: { idempotencyKey } });
    if (!existing) return prisma.forwardedSignal.create({ data: base });
    return prisma.forwardedSignal.update({ where: { id: existing.id }, data: base });
  } catch (e) {
    // ignore unique conflict races
  }
}

function normalizeForStorage(obj) {
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    if (Object.prototype.hasOwnProperty.call(clone, 'secret')) clone.secret = '[redacted]';
    return clone;
  } catch {
    return {};
  }
}
