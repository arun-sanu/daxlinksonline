import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import { createMexcSpotClient } from '../services/mexcSpotClient.js';
import { SizingConfigError, computeMexcBaseQuantityForSignal } from '../services/orderSizingService.js';
import { EXECUTION_AUDIT_STATUS, updateExecutionAudit } from '../services/executionAuditService.js';

const isDryRun = process.env.WORKFLOW_EXECUTION_MODE === 'dryrun';
const DEBUG_TV_WEBHOOK = String(process.env.DEBUG_TV_WEBHOOK || 'false').toLowerCase() === 'true';

function debugExecution(stage, data = {}) {
  if (!DEBUG_TV_WEBHOOK) return;
  try {
    console.log('[tv-webhook-debug]', JSON.stringify({ stage, ...data }));
  } catch {
    console.log('[tv-webhook-debug]', stage);
  }
}

function toBuffer(value) {
  if (!value) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return Buffer.from(value);
}

function decryptRequired(blob, label) {
  if (!blob || (blob.length !== undefined && blob.length === 0)) {
    throw new Error(`${label} is missing`);
  }
  const secret = decrypt(toBuffer(blob));
  const trimmed = String(secret || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is empty after trimming`);
  }
  return trimmed;
}

function decryptOptional(blob) {
  if (!blob || (blob.length !== undefined && blob.length === 0)) return undefined;
  const secret = decrypt(toBuffer(blob));
  const trimmed = String(secret || '').trim();
  return trimmed || undefined;
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (side === 'BUY' || side === 'LONG') return 'BUY';
  if (side === 'SELL' || side === 'SHORT') return 'SELL';
  return null;
}

function normalizeOrderType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!type) return 'MARKET';
  if (type === 'market') return 'MARKET';
  if (type === 'limit') return 'LIMIT';
  return type.toUpperCase();
}

function parseNumeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toJsonSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function getAlertId(signal) {
  return signal?.payload?.raw?.alertId || signal?.payload?.alertId || null;
}

function getExecutionAuditId(signal) {
  return signal?.payload?.raw?.executionAuditId || signal?.payload?.executionAuditId || null;
}

function resolveSignalSymbol(signal) {
  const fromPayload = signal?.payload?.raw?.symbol || signal?.payload?.symbol || null;
  const symbol = String(signal?.symbol || fromPayload || '').trim().toUpperCase();
  return symbol || null;
}

function resolveClientOrderId(signal) {
  return (
    signal?.payload?.raw?.clientOrderId ||
    signal?.payload?.raw?.client_id ||
    signal?.payload?.raw?.order_id ||
    signal?.payload?.raw?.id ||
    signal?.idempotencyKey ||
    null
  );
}

async function markAlertStatus(alertId, status, message = null) {
  if (!alertId) return;
  try {
    await updateTradingviewAlertStatus(alertId, status, message);
  } catch {
    // Never block execution on alert bookkeeping.
  }
}

async function markExecutionAudit(auditId, patch) {
  if (!auditId) return;
  try {
    await updateExecutionAudit(auditId, patch);
    debugExecution('audit_updated', {
      auditId,
      status: patch?.status || null
    });
  } catch {
    // Never block execution on audit bookkeeping.
  }
}

async function markSignalExecutionError({ signalId, alertId, auditId, message, auditStatus = EXECUTION_AUDIT_STATUS.ERROR }) {
  debugExecution('executed', {
    auditId: auditId || null,
    status: auditStatus,
    error: message
  });
  await markAlertStatus(alertId, 'failed', message);
  await markExecutionAudit(auditId, {
    status: auditStatus,
    errorMessage: message
  });
  await prisma.forwardedSignal.update({
    where: { id: signalId },
    data: {
      status: 'executed_error',
      error: message,
      attempts: { increment: 1 }
    }
  });
  return { ok: false, error: message, retry: false };
}

async function placeOrderBestEffort(exchange, n) {
  const params = {
    symbol: n.symbol,
    side: n.side,
    type: n.type || 'MARKET',
    amount: n.amount || 0,
    qty: n.qty || n.amount || 0,
    quantity: n.quantity || n.qty || n.amount || 0,
    price: n.price,
    clientOrderId: n.clientOrderId,
    exchange: n.exchange,
    environment: n.environment,
    raw: n.raw
  };
  if (!params.symbol || !params.side) {
    throw new Error('Missing symbol/side in alert payload');
  }
  if (typeof exchange.submitSignal === 'function') return exchange.submitSignal(params);
  if (typeof exchange.createOrder === 'function') return exchange.createOrder(params);
  if (typeof exchange.placeOrder === 'function') return exchange.placeOrder(params);
  if (typeof exchange.order === 'function') return exchange.order(params);
  if (typeof exchange.trade === 'function') return exchange.trade(params);
  throw new Error('Exchange adapter does not support order placement');
}

export async function executePreparedSignal(signalId) {
  if (!signalId) return null;
  const signal = await prisma.forwardedSignal.findUnique({ where: { id: signalId } });
  if (!signal) throw new Error('Signal not found');
  if (!['ready_for_execution', 'retrying'].includes(signal.status)) {
    return { skipped: true, reason: 'status_not_ready' };
  }

  const alertId = getAlertId(signal);
  const executionAuditId = getExecutionAuditId(signal);

  if (!signal.integrationId) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Missing integration for execution',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  const integration = await prisma.integration.findUnique({
    where: { id: signal.integrationId },
    include: { credential: true }
  });
  if (!integration || !integration.credential) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Integration credentials missing',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  const symbol = resolveSignalSymbol(signal);
  const side = normalizeSide(signal.side || signal?.payload?.side || signal?.payload?.raw?.side);
  const orderType = normalizeOrderType(signal.type || signal?.payload?.type || signal?.payload?.raw?.type || 'market');

  if (!symbol || !side) {
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message: 'Mapped order incomplete: symbol/side missing',
      auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
    });
  }

  try {
    if (isDryRun) {
      const dryRunResult = {
        dryRun: true,
        symbol,
        side,
        type: 'MARKET'
      };
      await markAlertStatus(alertId, 'executed', 'Dry-run execution');
      await markExecutionAudit(executionAuditId, {
        status: EXECUTION_AUDIT_STATUS.SENT,
        mexcStatus: 'DRY_RUN',
        mexcRawResponse: dryRunResult
      });
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult: dryRunResult },
          executedAt: new Date()
        }
      });
      return { ok: true, dryRun: true };
    }

    const apiKey = decryptRequired(integration.credential.apiKey, 'API key');
    const apiSecret = decryptRequired(integration.credential.apiSecret, 'API secret');
    const passphrase = decryptOptional(integration.credential.passphrase);
    const clientOrderId = resolveClientOrderId(signal);

    const isMexc = String(integration.exchange || '').toLowerCase() === 'mexc';
    let result;

    if (isMexc) {
      const mexcClient = createMexcSpotClient({ apiKey, apiSecret });
      if (orderType !== 'MARKET') {
        return markSignalExecutionError({
          signalId,
          alertId,
          auditId: executionAuditId,
          message: 'Only MARKET orders are supported for TradingView -> MEXC path',
          auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
        });
      }

      const sizing = await computeMexcBaseQuantityForSignal({
        workspaceId: integration.workspaceId,
        symbol,
        client: mexcClient
      });

      await markExecutionAudit(executionAuditId, {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        botId: integration.id,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        qtyRaw: sizing.qtyRaw,
        qtyRounded: sizing.qtyRounded
      });

      result = await mexcClient.placeMarketOrderBaseQty({
        symbol,
        side,
        quantity: sizing.qtyRounded,
        newClientOrderId: clientOrderId
      });

      const mexcOrderId = result?.orderId || result?.id || null;
      let mexcStatus = result?.status || 'SENT';
      let finalAuditStatus = EXECUTION_AUDIT_STATUS.SENT;
      let orderSnapshot = null;

      if (mexcOrderId) {
        try {
          orderSnapshot = await mexcClient.getOrder({ symbol, orderId: mexcOrderId });
          mexcStatus = orderSnapshot?.status || mexcStatus;
          if (String(mexcStatus).toUpperCase() === 'FILLED') {
            finalAuditStatus = EXECUTION_AUDIT_STATUS.FILLED;
          }
        } catch {
          // keep SENT state if immediate order lookup fails.
        }
      }

      await markExecutionAudit(executionAuditId, {
        status: finalAuditStatus,
        mexcOrderId: mexcOrderId ? String(mexcOrderId) : null,
        mexcStatus,
        mexcRawResponse: orderSnapshot || result,
        errorMessage: null
      });
      debugExecution('executed', {
        auditId: executionAuditId || null,
        status: finalAuditStatus,
        mexcOrderId: mexcOrderId ? String(mexcOrderId) : null
      });

      const executionResult = {
        ...toJsonSafe(result),
        provider: 'mexc-direct',
        amountMode: 'base',
        quantity: sizing.qtyRounded,
        qtyRaw: sizing.qtyRaw,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        quoteAsset: sizing.quoteAsset
      };

      await markAlertStatus(alertId, 'executed', null);
      await prisma.forwardedSignal.update({
        where: { id: signalId },
        data: {
          status: 'executed_success',
          payload: { ...(signal.payload || {}), executionResult },
          executedAt: new Date(),
          error: null
        }
      });
      return { ok: true, result: executionResult };
    }

    const fallbackAmount = parseNumeric(signal.amount ?? signal.payload?.amount ?? signal.payload?.raw?.amount);
    if (!fallbackAmount || fallbackAmount <= 0) {
      return markSignalExecutionError({
        signalId,
        alertId,
        auditId: executionAuditId,
        message: 'Base quantity missing for non-MEXC execution path',
        auditStatus: EXECUTION_AUDIT_STATUS.REJECTED
      });
    }

    const exchangeClient = createExchange({
      exchange: integration.exchange,
      environment: integration.environment,
      apiKey,
      apiSecret,
      passphrase
    });
    result = await placeOrderBestEffort(exchangeClient, {
      symbol,
      side,
      type: orderType,
      amount: fallbackAmount,
      qty: fallbackAmount,
      quantity: fallbackAmount,
      clientOrderId,
      exchange: integration.exchange,
      environment: integration.environment,
      raw: signal.payload || {}
    });

    await markAlertStatus(alertId, 'executed', null);
    await markExecutionAudit(executionAuditId, {
      status: EXECUTION_AUDIT_STATUS.SENT,
      mexcStatus: 'SENT',
      mexcRawResponse: result,
      errorMessage: null
    });
    debugExecution('executed', {
      auditId: executionAuditId || null,
      status: EXECUTION_AUDIT_STATUS.SENT
    });
    await prisma.forwardedSignal.update({
      where: { id: signalId },
      data: {
        status: 'executed_success',
        payload: { ...(signal.payload || {}), executionResult: result },
        executedAt: new Date(),
        error: null
      }
    });
    return { ok: true, result };
  } catch (err) {
    const message = err?.message || String(err);
    const auditStatus = err instanceof SizingConfigError
      ? EXECUTION_AUDIT_STATUS.REJECTED
      : EXECUTION_AUDIT_STATUS.ERROR;
    return markSignalExecutionError({
      signalId,
      alertId,
      auditId: executionAuditId,
      message,
      auditStatus
    });
  }
}
