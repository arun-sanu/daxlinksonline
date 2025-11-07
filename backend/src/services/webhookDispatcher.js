import { prisma } from '../utils/prisma.js';
import { createHmac } from 'crypto';

function withTimeout(ms, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  const abort = () => clearTimeout(timeout);
  const combined = signal;
  return { signal: controller.signal, abort };
}

export async function dispatchToWebhook({ workspaceId, webhook, payload, timeoutMs = 8000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let status = 'sent';
  let responseCode = 0;
  let lastError = null;
  let responseBody = null;
  let responseHeaders = null;
  const start = Date.now();
  let responseTimeMs = null;
  try {
    const bodyJson = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    // Optional HMAC signature when secret is available in-memory (future resolver will supply it)
    const secret = webhook && webhook.signingSecret;
    if (secret) {
      const timestamp = Date.now();
      const sig = createHmac('sha256', String(secret)).update(`${bodyJson}.${timestamp}`).digest('hex');
      headers['X-Daxlinks-Signature'] = `t=${timestamp},v1=${sig}`;
    }
    const resp = await fetch(webhook.url, {
      method: webhook.method || 'POST',
      headers,
      body: bodyJson,
      signal: controller.signal
    });
    responseCode = resp.status;
    try {
      responseHeaders = {};
      resp.headers?.forEach?.((v, k) => { responseHeaders[k] = v; });
    } catch {}
    try {
      responseBody = await resp.text();
      if (responseBody && responseBody.length > 4096) responseBody = responseBody.slice(0, 4096);
    } catch {}
    if (!resp.ok) {
      status = 'failed';
      lastError = `HTTP ${resp.status}`;
    }
  } catch (e) {
    status = 'failed';
    lastError = e?.message || String(e);
  } finally {
    clearTimeout(timeout);
    responseTimeMs = Date.now() - start;
  }

  const delivery = await prisma.webhookDelivery.create({
    data: {
      workspaceId,
      webhookId: webhook.id,
      status,
      attempts: 1,
      lastError,
      responseCode,
      responseBody,
      responseHeaders,
      responseTimeMs,
      payload
    }
  });
  return { status, responseCode, lastError, responseBody, responseHeaders, responseTimeMs, deliveryId: delivery.id };
}

export async function dispatchWorkspaceEvent({ workspaceId, event, data }) {
  const payload = { id: `evt_${Date.now()}`, event, data };
  const hooks = await prisma.webhook.findMany({ where: { workspaceId, active: true } });
  const results = [];
  for (const webhook of hooks) {
    // Dispatch sequentially to keep it simple; change to Promise.allSettled if needed
    const result = await dispatchToWebhook({ workspaceId, webhook, payload });
    results.push({ webhookId: webhook.id, ...result });
  }
  return { count: results.length, results };
}
