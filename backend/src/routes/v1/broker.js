/**
 * Utilities for validating bot/broker order requests.
 * These are used by tests and can be reused by future broker routes.
 */

export function ensureInstanceScope(instance, workspaceId) {
  if (!instance) {
    throw new Error('Bot instance not found');
  }
  if (instance.workspaceId !== workspaceId) {
    throw new Error('Cross-workspace token rejected');
  }
  return instance;
}

export function preflightValidateOrder(instance, body) {
  if (!instance) {
    throw new Error('Bot instance not found');
  }
  if (instance.status && instance.status !== 'running') {
    throw new Error('Bot instance not running');
  }

  const { symbol, side, type, price, qty } = body || {};
  if (!symbol || !side || !type) {
    throw new Error('Missing symbol/side/type');
  }

  if (typeof qty !== 'number' || Number.isNaN(qty) || qty <= 0) {
    throw new Error('Quantity must be positive');
  }

  if (type === 'LIMIT') {
    if (typeof price !== 'number' || Number.isNaN(price) || price <= 0) {
      throw new Error('Limit orders require positive price');
    }
  }

  const notional = typeof price === 'number' ? price * qty : 0;
  if (instance.minNotional && notional < instance.minNotional) {
    throw new Error('Below minNotional');
  }

  return { symbol, side, type, price, qty };
}
