import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateRules } from '../src/services/workflowService.js';

test('simulateRules leaves mapped size null when position size is not configured', async () => {
  const rules = [
    {
      id: 'rule-1',
      enabled: true,
      source: { id: 'tv:moneyplantbot1' },
      destination: { type: 'integration', id: 'integration-1' },
      conditions: { symbols: ['*'] },
      mapping: { orderType: 'market', positionSizeType: 'absolute' }
    }
  ];

  const result = await simulateRules({
    workspaceId: 'workspace-1',
    rules,
    source: { id: 'tv:moneyplantbot1' },
    signal: { symbol: 'BTCUSDC', side: 'buy', amount: 2, notional: 2 }
  });

  assert.equal(result.matchedRules.length, 1);
  assert.equal(result.matchedRules[0].mappedOrder.orderType, 'market');
  assert.equal(result.matchedRules[0].mappedOrder.size, null);
});

test('simulateRules maps percent sizing with positive value', async () => {
  const rules = [
    {
      id: 'rule-2',
      enabled: true,
      source: { id: 'tv:moneyplantbot1' },
      destination: { type: 'integration', id: 'integration-1' },
      conditions: { symbols: ['BTCUSDC'] },
      mapping: { orderType: 'limit', positionSizeType: 'percent', positionSizeValue: 25 }
    }
  ];

  const result = await simulateRules({
    workspaceId: 'workspace-1',
    rules,
    source: { id: 'tv:moneyplantbot1' },
    signal: { symbol: 'BTCUSDC', side: 'sell', amount: 1, notional: 1 }
  });

  assert.equal(result.matchedRules.length, 1);
  assert.equal(result.matchedRules[0].mappedOrder.size, '25%');
});
