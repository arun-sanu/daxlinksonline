import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureInstanceScope, preflightValidateOrder } from '../src/routes/v1/broker.js';

test('cross-workspace bot token rejected', () => {
  // Simulate instance belonging to ws_A
  const inst = { id: 'inst_1', workspaceId: 'ws_A', status: 'running', symbol: 'BTCUSDT', minNotional: 10 };
  // In real handler, this mismatch triggers 403 before preflight; emulate here
  assert.throws(() => {
    ensureInstanceScope(inst, 'ws_B');
  }, /Cross-workspace token rejected/);
});

test('below minNotional rejected', () => {
  const inst = { id: 'inst_2', workspaceId: 'ws_A', status: 'running', symbol: 'BTCUSDT', minNotional: 100 };
  const body = { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: 50, qty: 1, idempotencyKey: 'k1' };
  assert.throws(() => preflightValidateOrder(inst, body), /Below minNotional/);
});
