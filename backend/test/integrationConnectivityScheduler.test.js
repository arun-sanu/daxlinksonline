import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyRandomSlots } from '../src/services/integrationConnectivityScheduler.js';

test('buildDailyRandomSlots returns 5 sorted unique UTC minute slots by default', () => {
  const slots = buildDailyRandomSlots('integration-1', '2026-02-24');
  assert.equal(slots.length, 5);
  assert.deepEqual([...slots].sort((a, b) => a - b), slots);
  assert.equal(new Set(slots).size, slots.length);
  for (const minute of slots) {
    assert.equal(Number.isInteger(minute), true);
    assert.equal(minute >= 0, true);
    assert.equal(minute < 1440, true);
  }
});

test('buildDailyRandomSlots is deterministic for integration/day', () => {
  const first = buildDailyRandomSlots('integration-abc', '2026-02-24', 5);
  const second = buildDailyRandomSlots('integration-abc', '2026-02-24', 5);
  assert.deepEqual(first, second);
});

test('buildDailyRandomSlots enforces count bounds between 1 and 24', () => {
  const low = buildDailyRandomSlots('integration-low', '2026-02-24', 1);
  assert.equal(low.length, 1);

  const invalid = buildDailyRandomSlots('integration-invalid', '2026-02-24', 0);
  assert.equal(invalid.length, 5);

  const high = buildDailyRandomSlots('integration-high', '2026-02-24', 100);
  assert.equal(high.length, 24);
});
