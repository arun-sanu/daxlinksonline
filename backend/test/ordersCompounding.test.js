import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../src/utils/prisma.js';
import { getWorkspaceTradeCompoundingReport } from '../src/services/ordersService.js';

function applyWhere(rows, where = {}) {
  return rows.filter((row) => {
    if (where.workspaceId && row.workspaceId !== where.workspaceId) return false;
    if (where.integrationId && row.integrationId !== where.integrationId) return false;
    if (where.symbol && row.symbol !== where.symbol) return false;
    if (where.botId && row.botId !== where.botId) return false;
    if (where.botInstanceId && row.botInstanceId !== where.botInstanceId) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;

    if (where.executedAt?.gte && new Date(row.executedAt) < new Date(where.executedAt.gte)) return false;
    if (where.executedAt?.lte && new Date(row.executedAt) > new Date(where.executedAt.lte)) return false;

    return true;
  });
}

function installPrismaStubs(t, rows) {
  const originals = {
    workspaceFindUnique: prisma.workspace.findUnique,
    tradeCount: prisma.tradeTransaction.count,
    tradeFindMany: prisma.tradeTransaction.findMany,
    botFindMany: prisma.bot.findMany
  };

  prisma.workspace.findUnique = async ({ where }) => (where?.id === 'ws-1' ? { id: 'ws-1' } : null);

  prisma.tradeTransaction.count = async ({ where }) => applyWhere(rows, where).length;

  prisma.tradeTransaction.findMany = async ({ where, orderBy, take }) => {
    let out = applyWhere(rows, where);
    if (Array.isArray(orderBy) && orderBy.length) {
      out = out.sort((a, b) => {
        const at = new Date(a.executedAt).getTime();
        const bt = new Date(b.executedAt).getTime();
        if (bt !== at) return bt - at;
        return (b.createdAt || bt) - (a.createdAt || at);
      });
    }
    if (typeof take === 'number') out = out.slice(0, take);
    return out;
  };

  prisma.bot.findMany = async ({ where }) => {
    const ids = where?.id?.in || [];
    return ids.map((id) => ({ id, name: `Bot-${id}` }));
  };

  t.after(() => {
    prisma.workspace.findUnique = originals.workspaceFindUnique;
    prisma.tradeTransaction.count = originals.tradeCount;
    prisma.tradeTransaction.findMany = originals.tradeFindMany;
    prisma.bot.findMany = originals.botFindMany;
  });
}

test('compounding defaults to final statuses and derives starting capital from first cashflow', async (t) => {
  const rows = [
    {
      id: 'tx-1',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      botInstanceId: 'inst-1',
      integrationId: 'int-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      status: 'filled',
      amount: 0.001,
      quantity: 0.001,
      value: 20,
      feeAmount: 0,
      realizedPnl: null,
      marketPrice: 20000,
      executionPrice: 20000,
      accountBalanceBefore: null,
      accountBalanceAfter: 80,
      accountEquityBefore: null,
      accountEquityAfter: null,
      balanceAsset: 'USDT',
      positionQtyBefore: 0,
      positionQtyAfter: 0.001,
      metadata: null,
      executedAt: new Date('2026-02-10T10:00:00.000Z'),
      createdAt: new Date('2026-02-10T10:00:00.000Z')
    },
    {
      id: 'tx-2',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      botInstanceId: 'inst-1',
      integrationId: 'int-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      status: 'sent',
      amount: 0.0005,
      quantity: 0.0005,
      value: 10,
      feeAmount: 0,
      realizedPnl: null,
      marketPrice: 20000,
      executionPrice: 20000,
      accountBalanceBefore: 80,
      accountBalanceAfter: 70,
      accountEquityBefore: null,
      accountEquityAfter: null,
      balanceAsset: 'USDT',
      metadata: null,
      executedAt: new Date('2026-02-10T11:00:00.000Z'),
      createdAt: new Date('2026-02-10T11:00:00.000Z')
    },
    {
      id: 'tx-3',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      botInstanceId: 'inst-1',
      integrationId: 'int-1',
      symbol: 'BTCUSDT',
      side: 'SELL',
      status: 'filled',
      amount: 0.001,
      quantity: 0.001,
      value: 30,
      feeAmount: 1,
      realizedPnl: 5,
      marketPrice: 30000,
      executionPrice: 30000,
      accountBalanceBefore: 80,
      accountBalanceAfter: 110,
      accountEquityBefore: null,
      accountEquityAfter: null,
      balanceAsset: 'USDT',
      positionQtyBefore: 0.001,
      positionQtyAfter: 0,
      metadata: null,
      executedAt: new Date('2026-02-10T12:00:00.000Z'),
      createdAt: new Date('2026-02-10T12:00:00.000Z')
    }
  ];

  installPrismaStubs(t, rows);

  const report = await getWorkspaceTradeCompoundingReport({
    workspaceId: 'ws-1',
    integrationId: 'int-1',
    symbol: 'BTCUSDT',
    bucket: 'hour',
    limit: 50
  });

  assert.equal(report.ok, true);
  assert.equal(report.summary.trades, 2);
  assert.equal(report.summary.startingCapital, 100);
  assert.equal(report.summary.endingCapital, 110);
  assert.equal(report.filters.includeNonFinal, false);
  assert.equal(report.recentTrades[0].positionQtyBefore, 0.001);
  assert.equal(report.recentTrades[0].positionQtyAfter, 0);
  assert.equal(report.recentTrades[0].position.stateBefore, 'LONG');
  assert.equal(report.recentTrades[0].position.stateAfter, 'FLAT');
});

test('compounding includes non-final rows when includeNonFinal=true', async (t) => {
  const rows = [
    {
      id: 'tx-a',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      botInstanceId: 'inst-1',
      integrationId: 'int-1',
      symbol: 'ETHUSDT',
      side: 'BUY',
      status: 'filled',
      amount: 0.1,
      quantity: 0.1,
      value: 200,
      feeAmount: 0.5,
      realizedPnl: null,
      accountBalanceBefore: 1000,
      accountBalanceAfter: 800,
      metadata: null,
      executedAt: new Date('2026-02-11T10:00:00.000Z'),
      createdAt: new Date('2026-02-11T10:00:00.000Z')
    },
    {
      id: 'tx-b',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      botInstanceId: 'inst-1',
      integrationId: 'int-1',
      symbol: 'ETHUSDT',
      side: 'BUY',
      status: 'sent',
      amount: 0.01,
      quantity: 0.01,
      value: 20,
      feeAmount: 0,
      realizedPnl: null,
      accountBalanceBefore: 800,
      accountBalanceAfter: 780,
      metadata: null,
      executedAt: new Date('2026-02-11T11:00:00.000Z'),
      createdAt: new Date('2026-02-11T11:00:00.000Z')
    }
  ];

  installPrismaStubs(t, rows);

  const report = await getWorkspaceTradeCompoundingReport({
    workspaceId: 'ws-1',
    integrationId: 'int-1',
    symbol: 'ETHUSDT',
    includeNonFinal: true,
    bucket: 'day'
  });

  assert.equal(report.summary.trades, 2);
  assert.equal(report.filters.includeNonFinal, true);
});

test('date-only "to" filter is inclusive through end-of-day UTC', async (t) => {
  const rows = [
    {
      id: 'tx-z',
      workspaceId: 'ws-1',
      botId: 'bot-2',
      botInstanceId: 'inst-2',
      integrationId: 'int-2',
      symbol: 'SOLUSDT',
      side: 'SELL',
      status: 'filled',
      amount: 5,
      quantity: 5,
      value: 500,
      feeAmount: 1,
      realizedPnl: 25,
      accountBalanceBefore: 1000,
      accountBalanceAfter: 1500,
      metadata: null,
      executedAt: new Date('2026-02-12T20:30:00.000Z'),
      createdAt: new Date('2026-02-12T20:30:00.000Z')
    }
  ];

  installPrismaStubs(t, rows);

  const report = await getWorkspaceTradeCompoundingReport({
    workspaceId: 'ws-1',
    integrationId: 'int-2',
    symbol: 'SOLUSDT',
    from: '2026-02-12',
    to: '2026-02-12',
    bucket: 'day'
  });

  assert.equal(report.summary.trades, 1);
});

test('trade bucket keeps separate curve points for same timestamp trades', async (t) => {
  const ts = new Date('2026-02-13T10:00:00.000Z');
  const rows = [
    {
      id: 'tx-1',
      workspaceId: 'ws-1',
      botId: 'bot-3',
      botInstanceId: 'inst-3',
      integrationId: 'int-3',
      symbol: 'XRPUSDT',
      side: 'BUY',
      status: 'filled',
      amount: 100,
      quantity: 100,
      value: 200,
      feeAmount: 0.2,
      realizedPnl: null,
      accountBalanceBefore: 1000,
      accountBalanceAfter: 800,
      metadata: null,
      executedAt: ts,
      createdAt: ts
    },
    {
      id: 'tx-2',
      workspaceId: 'ws-1',
      botId: 'bot-3',
      botInstanceId: 'inst-3',
      integrationId: 'int-3',
      symbol: 'XRPUSDT',
      side: 'SELL',
      status: 'filled',
      amount: 100,
      quantity: 100,
      value: 220,
      feeAmount: 0.2,
      realizedPnl: 20,
      accountBalanceBefore: 800,
      accountBalanceAfter: 1020,
      metadata: null,
      executedAt: ts,
      createdAt: ts
    }
  ];

  installPrismaStubs(t, rows);

  const report = await getWorkspaceTradeCompoundingReport({
    workspaceId: 'ws-1',
    integrationId: 'int-3',
    symbol: 'XRPUSDT',
    bucket: 'trade'
  });

  assert.equal(report.summary.trades, 2);
  assert.equal(report.curve.length, 2);
  assert.equal(report.curve[0].timestamp, ts.toISOString());
  assert.equal(report.curve[1].timestamp, ts.toISOString());
});
