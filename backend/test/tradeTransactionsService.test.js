import test from 'node:test';
import assert from 'node:assert/strict';

import { recordTradeTransaction } from '../src/services/tradeTransactionsService.js';

function buildDbStub(capture) {
  return {
    tradeTransaction: {
      async create({ data }) {
        capture.data = data;
        return data;
      }
    }
  };
}

test('recordTradeTransaction infers position quantities from sizing context for BUY', async () => {
  const capture = { data: null };
  const db = buildDbStub(capture);

  await recordTradeTransaction(
    {
      workspaceId: 'ws-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 0.25,
      sizingContext: {
        sizingDebug: {
          freeBase: 1.5
        }
      }
    },
    { db }
  );

  assert.equal(String(capture.data.positionQtyBefore), '1.5');
  assert.equal(String(capture.data.positionQtyAfter), '1.75');
});

test('recordTradeTransaction keeps explicit position quantities when provided', async () => {
  const capture = { data: null };
  const db = buildDbStub(capture);

  await recordTradeTransaction(
    {
      workspaceId: 'ws-1',
      symbol: 'BTCUSDT',
      side: 'SELL',
      quantity: 0.25,
      positionQtyBefore: 2,
      positionQtyAfter: 1.75
    },
    { db }
  );

  assert.equal(String(capture.data.positionQtyBefore), '2');
  assert.equal(String(capture.data.positionQtyAfter), '1.75');
});
