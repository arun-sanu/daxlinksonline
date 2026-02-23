import { prisma } from '../utils/prisma.js';
import { decrypt } from '../lib/kms.js';
import { createExchange } from '../sdk/index.js';
import { updateTradingviewAlertStatus } from '../services/tradingviewAlertsService.js';
import { createMexcSpotClient } from '../services/mexcSpotClient.js';
import {
  SizingConfigError,
  computeMexcBaseQuantityForSignal,
  computeMexcBaseQuantityFromSignalPayload
} from '../services/orderSizingService.js';
import { EXECUTION_AUDIT_STATUS, updateExecutionAudit } from '../services/executionAuditService.js';
import { recordTradeTransaction } from '../services/tradeTransactionsService.js';

const isDryRun = process.env.WORKFLOW_EXECUTION_MODE === 'dryrun';
const DEBUG_TV_WEBHOOK = String(process.env.DEBUG_TV_WEBHOOK || 'false').toLowerCase() === 'true';
const ARN_ORIGINAL_BOT_NAME_SLUGS = new Set([
  'arn-s-shcs-orginal',
  'arn-s-shcs-original'
]);

function debugExecution(stage, data = {}) {
  if (!DEBUG_TV_WEBHOOK) return;
  try {
    console.log('[tv-webhook-debug]', JSON.stringify({ stage, ...data }));
  } catch {
    console.log('[tv-webhook-debug]', stage);
  }
}

function logLedgerWriteError(error, context = {}) {
  const message = error?.message || String(error || 'unknown ledger write error');
  try {
    console.error(
      '[trade-ledger-write-failed]',
      JSON.stringify({
        message,
        ...context
      })
    );
  } catch {
    console.error('[trade-ledger-write-failed]', message);
  }
  debugExecution('ledger_write_failed', {
    message,
    ...context
  });
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

function normalizeTextSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isArnOriginalBotName(value = '') {
  const slug = normalizeTextSlug(value);
  if (!slug) return false;
  if (ARN_ORIGINAL_BOT_NAME_SLUGS.has(slug)) return true;
  return slug.includes('arn') && slug.includes('shcs') && (slug.includes('orginal') || slug.includes('original'));
}

function isArnPineStrategy(value = '') {
  return String(value || '').trim().toUpperCase() === 'ARN_PINE_FAITHFUL';
}

function extractSignalPayloadSizingRequest(signal) {
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];

  const pickFirstNumeric = (keys = []) => {
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        const value = parseNumeric(source[key]);
        if (value !== null && value > 0) return value;
      }
    }
    return null;
  };

  const requestedQty = pickFirstNumeric(['qty', 'quantity', 'baseQty', 'baseQuantity', 'size']);
  const requestedAmount =
    pickFirstNumeric(['amount', 'quoteAmount', 'quoteQty', 'notional']) ||
    (() => {
      const amount = parseNumeric(signal?.amount);
      return amount !== null && amount > 0 ? amount : null;
    })();

  return { requestedQty, requestedAmount };
}

async function resolveRuntimeTradeBotForIntegration(workspaceId, integrationId) {
  const normalizedWorkspaceId = String(workspaceId || '').trim();
  const normalizedIntegrationId = String(integrationId || '').trim();
  if (!normalizedWorkspaceId || !normalizedIntegrationId) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      arnOriginal: false
    };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: normalizedWorkspaceId },
    select: { workflowConfig: true }
  });
  const runtimeConfigs = workspace?.workflowConfig?.tradeBots?.runtimeConfigs;
  if (!runtimeConfigs || typeof runtimeConfigs !== 'object' || Array.isArray(runtimeConfigs)) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      arnOriginal: false
    };
  }

  let matchedBotId = null;
  let matchedStrategy = null;
  for (const [botId, entry] of Object.entries(runtimeConfigs)) {
    if (!entry || typeof entry !== 'object') continue;
    const linkedIntegrationId = String(entry?.links?.integrationId || '').trim();
    if (!linkedIntegrationId || linkedIntegrationId !== normalizedIntegrationId) continue;
    matchedBotId = botId;
    matchedStrategy = entry?.rules?.strategy || null;
    break;
  }

  if (!matchedBotId) {
    return {
      botId: null,
      botName: null,
      strategy: null,
      arnOriginal: false
    };
  }

  const bot = await prisma.bot.findUnique({
    where: { id: matchedBotId },
    select: { id: true, name: true }
  });
  const botName = bot?.name || null;
  const arnOriginal = isArnPineStrategy(matchedStrategy) || isArnOriginalBotName(botName);

  return {
    botId: matchedBotId,
    botName,
    strategy: matchedStrategy,
    arnOriginal
  };
}

function hasSignalPayloadSizingHint(signal) {
  const keys = ['qty', 'quantity', 'baseQty', 'baseQuantity', 'size', 'amount', 'quoteAmount', 'quoteQty', 'notional'];
  const keySet = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key).toLowerCase()));
  const payload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
  const rawPayload = payload?.raw && typeof payload.raw === 'object' ? payload.raw : {};
  const sources = [rawPayload, payload];

  for (const obj of sources) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of Object.keys(obj)) {
      if (!keySet.has(String(key).toLowerCase())) continue;
      return true;
    }
  }

  return false;
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

async function markSignalExecutionError({
  signalId,
  alertId,
  auditId,
  message,
  auditStatus = EXECUTION_AUDIT_STATUS.ERROR,
  sizingDebug = undefined
}) {
  debugExecution('executed', {
    auditId: auditId || null,
    status: auditStatus,
    error: message
  });
  await markAlertStatus(alertId, 'failed', message);
  const auditPatch = {
    status: auditStatus,
    errorMessage: message
  };
  if (sizingDebug !== undefined) {
    auditPatch.sizingDebug = sizingDebug;
  }
  await markExecutionAudit(auditId, auditPatch);
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
    include: {
      credentials: {
        orderBy: { updatedAt: 'desc' },
        take: 1
      }
    }
  });
  const activeCredential = integration?.credentials?.[0];
  if (!integration || !activeCredential) {
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

    const apiKey = decryptRequired(activeCredential.apiKey, 'API key');
    const apiSecret = decryptRequired(activeCredential.apiSecret, 'API secret');
    const passphrase = decryptOptional(activeCredential.passphrase);
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

      const payloadSizingRequested = hasSignalPayloadSizingHint(signal);
      const payloadSizingRequest = extractSignalPayloadSizingRequest(signal);
      const runtimeBot = await resolveRuntimeTradeBotForIntegration(integration.workspaceId, integration.id);
      const payloadSizingApplied =
        runtimeBot.arnOriginal &&
        payloadSizingRequested &&
        ((payloadSizingRequest.requestedQty && payloadSizingRequest.requestedQty > 0) ||
          (payloadSizingRequest.requestedAmount && payloadSizingRequest.requestedAmount > 0));
      const ignoredPayloadSizing = payloadSizingRequested && !payloadSizingApplied;

      const sizing = payloadSizingApplied
        ? await computeMexcBaseQuantityFromSignalPayload({
            symbol,
            side,
            client: mexcClient,
            requestedQty: payloadSizingRequest.requestedQty,
            requestedAmount: payloadSizingRequest.requestedAmount
          })
        : await computeMexcBaseQuantityForSignal({
            workspaceId: integration.workspaceId,
            integrationId: integration.id,
            symbol,
            side,
            client: mexcClient
          });
      const effectiveSizingSource = payloadSizingApplied
        ? 'pine_payload_arn_original'
        : sizing.sizingSource || 'trade_bot_runtime';
      const resolvedAuditBotId = runtimeBot.botId || integration.id;

      await markExecutionAudit(executionAuditId, {
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        botId: resolvedAuditBotId,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        qtyRaw: sizing.qtyRaw,
        qtyRounded: sizing.qtyRounded,
        sizingDebug: {
          ...(sizing.sizingDebug || {}),
          sizingSource: effectiveSizingSource,
          payloadSizingRequested,
          payloadSizingApplied,
          ignoredPayloadSizing,
          runtimeBotId: runtimeBot.botId || null,
          runtimeBotName: runtimeBot.botName || null,
          runtimeBotStrategy: runtimeBot.strategy || null,
          runtimeBotArnOriginal: runtimeBot.arnOriginal === true
        }
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
        sizingSource: effectiveSizingSource,
        payloadSizingRequested,
        payloadSizingApplied,
        ignoredPayloadSizing,
        quantity: sizing.qtyRounded,
        qtyRaw: sizing.qtyRaw,
        computedPrice: sizing.computedPrice,
        freeQuote: sizing.freeQuote,
        quoteAsset: sizing.quoteAsset,
        runtimeBotId: runtimeBot.botId || null,
        runtimeBotName: runtimeBot.botName || null
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

      const signalPayload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
      const signalRaw = signalPayload?.raw && typeof signalPayload.raw === 'object' ? signalPayload.raw : {};
      const fills = Array.isArray(orderSnapshot?.fills)
        ? orderSnapshot.fills
        : Array.isArray(result?.fills)
          ? result.fills
          : [];
      const firstFill = fills[0] || null;
      const resolvedQuantity = parseNumeric(orderSnapshot?.executedQty ?? result?.executedQty ?? sizing.qtyRounded);
      const resolvedValue = parseNumeric(orderSnapshot?.cummulativeQuoteQty ?? result?.cummulativeQuoteQty ?? result?.quoteQty);
      const explicitExecutionPrice = parseNumeric(orderSnapshot?.price ?? result?.price);
      const resolvedExecutionPrice =
        explicitExecutionPrice && explicitExecutionPrice > 0
          ? explicitExecutionPrice
          : resolvedValue && resolvedQuantity && resolvedQuantity > 0
            ? resolvedValue / resolvedQuantity
            : null;

      try {
        await recordTradeTransaction({
          workspaceId: integration.workspaceId,
          botId: signalRaw?.botId || signalPayload?.botId || null,
          botInstanceId: signalRaw?.botInstanceId || signalPayload?.botInstanceId || null,
          orderId: null,
          executionAuditId: executionAuditId || null,
          forwardedSignalId: signal.id,
          integrationId: integration.id,
          exchangeAccountId: signalRaw?.exchangeAccountId || signalPayload?.exchangeAccountId || null,
          venue: integration.exchange || 'mexc',
          symbol,
          side,
          orderType,
          status: String(mexcStatus || finalAuditStatus || 'sent').toLowerCase(),
          amount: parseNumeric(sizing.qtyRaw ?? sizing.qtyRounded),
          quantity: resolvedQuantity,
          value: resolvedValue,
          marketPrice: parseNumeric(sizing.computedPrice),
          executionPrice: resolvedExecutionPrice,
          feeAmount: parseNumeric(firstFill?.commission),
          feeAsset: firstFill?.commissionAsset || null,
          accountBalanceBefore: parseNumeric(sizing.freeQuote),
          balanceAsset: sizing.quoteAsset || null,
          decisionContext: toJsonSafe({
            source: 'tradingview_forwarder',
            signalType: signal.type || null,
            payloadSizingRequested,
            payloadSizingApplied,
            ignoredPayloadSizing,
            idempotencyKey: signal.idempotencyKey || null
          }),
          sizingContext: toJsonSafe({
            qtyRaw: sizing.qtyRaw,
            qtyRounded: sizing.qtyRounded,
            computedPrice: sizing.computedPrice,
            freeQuote: sizing.freeQuote,
            sizingSource: effectiveSizingSource,
            sizingDebug: sizing.sizingDebug || {}
          }),
          exchangePayload: toJsonSafe({
            placeOrderResult: result,
            orderSnapshot
          }),
          metadata: toJsonSafe({
            alertId,
            clientOrderId,
            mexcOrderId: mexcOrderId ? String(mexcOrderId) : null,
            flow: 'executePreparedSignal.mexc'
          }),
          executedAt: orderSnapshot?.updateTime || result?.transactTime || new Date()
        });
      } catch (ledgerError) {
        // Never block execution on ledger writes.
        logLedgerWriteError(ledgerError, {
          flow: 'executePreparedSignal.mexc',
          signalId,
          executionAuditId: executionAuditId || null,
          integrationId: integration.id,
          symbol,
          side
        });
      }

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

    const signalPayload = signal?.payload && typeof signal.payload === 'object' ? signal.payload : {};
    const signalRaw = signalPayload?.raw && typeof signalPayload.raw === 'object' ? signalPayload.raw : {};
    try {
      await recordTradeTransaction({
        workspaceId: integration.workspaceId,
        botId: signalRaw?.botId || signalPayload?.botId || null,
        botInstanceId: signalRaw?.botInstanceId || signalPayload?.botInstanceId || null,
        orderId: null,
        executionAuditId: executionAuditId || null,
        forwardedSignalId: signal.id,
        integrationId: integration.id,
        exchangeAccountId: signalRaw?.exchangeAccountId || signalPayload?.exchangeAccountId || null,
        venue: integration.exchange || null,
        symbol,
        side,
        orderType,
        status: 'sent',
        amount: fallbackAmount,
        quantity: fallbackAmount,
        value: parseNumeric(result?.cummulativeQuoteQty ?? result?.quoteQty ?? result?.cost),
        marketPrice: parseNumeric(signal.price ?? signalPayload?.price ?? signalRaw?.price),
        executionPrice: parseNumeric(result?.price ?? signal.price ?? signalPayload?.price ?? signalRaw?.price),
        feeAmount: parseNumeric(result?.fee?.cost ?? result?.feeAmount),
        feeAsset: result?.fee?.currency || result?.feeAsset || null,
        decisionContext: toJsonSafe({
          source: 'tradingview_forwarder',
          idempotencyKey: signal.idempotencyKey || null
        }),
        sizingContext: toJsonSafe({
          mode: 'fallback_amount',
          fallbackAmount
        }),
        exchangePayload: toJsonSafe(result),
        metadata: toJsonSafe({
          alertId,
          clientOrderId,
          flow: 'executePreparedSignal.generic'
        }),
        executedAt: result?.transactTime || result?.timestamp || new Date()
      });
    } catch (ledgerError) {
      // Never block execution on ledger writes.
      logLedgerWriteError(ledgerError, {
        flow: 'executePreparedSignal.generic',
        signalId,
        executionAuditId: executionAuditId || null,
        integrationId: integration.id,
        symbol,
        side
      });
    }

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
      auditStatus,
      sizingDebug: err?.sizingDebug
    });
  }
}
