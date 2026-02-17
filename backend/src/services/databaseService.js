import { randomUUID } from 'crypto';
import { prisma } from '../utils/prisma.js';

const DEFAULT_TABLE_ROWS_LIMIT = 100;
const MAX_TABLE_ROWS_LIMIT = 500;

function mask(value) {
  if (!value) return null;
  const v = String(value);
  return v.length <= 4 ? '****' : `${v.slice(0, 4)}****`;
}

function toUpper(value) {
  const text = String(value || '')
    .trim()
    .toUpperCase();
  return text || null;
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TABLE_ROWS_LIMIT;
  return Math.min(Math.floor(n), MAX_TABLE_ROWS_LIMIT);
}

function parseDateInput(value, options = {}) {
  if (value === null || value === undefined || value === '') return null;
  const { endOfDayWhenDateOnly = false } = options;

  const raw = String(value).trim();
  if (!raw) return null;
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  if (endOfDayWhenDateOnly && isDateOnly) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function buildWorkspaceWhere(workspaceScope) {
  if (!workspaceScope) return {};
  if (Array.isArray(workspaceScope)) {
    if (workspaceScope.length === 0) {
      return { workspaceId: '__none__' };
    }
    return { workspaceId: { in: workspaceScope } };
  }
  return { workspaceId: String(workspaceScope) };
}

function isWorkspaceAccessible(workspaceId, workspaceScope) {
  if (!workspaceScope) return true;

  if (Array.isArray(workspaceScope)) {
    if (!workspaceId) return false;
    return workspaceScope.includes(workspaceId);
  }

  return workspaceId === String(workspaceScope);
}

function resolveTradeWorkspaceScope(db, workspaceScope) {
  if (db?.workspaceId) return db.workspaceId;
  return workspaceScope || null;
}

function buildTradeTableDescriptor(dbId, { records = 0, lastExecutedAt = null, lastUpdatedAt = null } = {}) {
  return {
    key: 'trade-transactions',
    name: 'TradeTransaction',
    purpose: 'Bot trade ledger for compounding, amount/quantity/value math, and PnL analytics',
    records,
    lastExecutedAt,
    lastUpdatedAt,
    queryPath: `/v1/admin/databases/${dbId}/tables/trade-transactions`
  };
}

async function getTradeTableStats(workspaceScope) {
  const where = {
    ...buildWorkspaceWhere(workspaceScope)
  };

  const [tradeCount, latestTrade] = await Promise.all([
    prisma.tradeTransaction.count({ where }),
    prisma.tradeTransaction.findFirst({
      where,
      orderBy: { executedAt: 'desc' },
      select: {
        executedAt: true,
        updatedAt: true
      }
    })
  ]);

  return {
    records: tradeCount,
    lastExecutedAt: asIso(latestTrade?.executedAt),
    lastUpdatedAt: asIso(latestTrade?.updatedAt)
  };
}

function mapTradeTransactionRow(row = {}) {
  const side = String(row.side || '')
    .trim()
    .toUpperCase();
  const quantity = asNumber(row.quantity);
  const marketPrice = asNumber(row.marketPrice);
  const executionPrice = asNumber(row.executionPrice);
  const explicitValue = asNumber(row.value);
  const executionValue =
    explicitValue !== null
      ? explicitValue
      : quantity !== null && executionPrice !== null
        ? quantity * executionPrice
        : null;
  const marketValue =
    quantity !== null && marketPrice !== null
      ? quantity * marketPrice
      : null;
  const buyPrice = side === 'BUY' || side === 'LONG' ? executionPrice : null;
  const sellPrice = side === 'SELL' || side === 'SHORT' ? executionPrice : null;
  const buyValue = side === 'BUY' || side === 'LONG' ? executionValue : null;
  const sellValue = side === 'SELL' || side === 'SHORT' ? executionValue : null;

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    botId: row.botId || null,
    botInstanceId: row.botInstanceId || null,
    orderId: row.orderId || null,
    executionAuditId: row.executionAuditId || null,
    forwardedSignalId: row.forwardedSignalId || null,
    integrationId: row.integrationId || null,
    exchangeAccountId: row.exchangeAccountId || null,
    venue: row.venue || null,
    symbol: row.symbol || null,
    side: side || null,
    orderType: row.orderType || null,
    status: row.status || null,
    amount: asNumber(row.amount),
    quantity,
    value: executionValue,
    marketValue,
    marketPrice,
    executionPrice,
    buyPrice,
    sellPrice,
    buyValue,
    sellValue,
    feeAmount: asNumber(row.feeAmount),
    feeAsset: row.feeAsset || null,
    realizedPnl: asNumber(row.realizedPnl),
    unrealizedPnl: asNumber(row.unrealizedPnl),
    accountBalanceBefore: asNumber(row.accountBalanceBefore),
    accountBalanceAfter: asNumber(row.accountBalanceAfter),
    accountEquityBefore: asNumber(row.accountEquityBefore),
    accountEquityAfter: asNumber(row.accountEquityAfter),
    balanceAsset: row.balanceAsset || null,
    positionQtyBefore: asNumber(row.positionQtyBefore),
    positionQtyAfter: asNumber(row.positionQtyAfter),
    executedAt: row.executedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    decisionContext: row.decisionContext || null,
    sizingContext: row.sizingContext || null,
    metadata: row.metadata || null
  };
}

export async function listDatabases({ workspaceScope = null, includeTableStats = false } = {}) {
  const rows = await prisma.databaseInstance.findMany({
    where: buildWorkspaceWhere(workspaceScope),
    orderBy: { createdAt: 'desc' }
  });

  if (!includeTableStats || rows.length === 0) {
    return rows;
  }

  const enrichedRows = await Promise.all(
    rows.map(async (row) => {
      const stats = await getTradeTableStats(resolveTradeWorkspaceScope(row, workspaceScope));
      return {
        ...row,
        tradesCount: stats.records,
        tables: [buildTradeTableDescriptor(row.id, stats)]
      };
    })
  );

  return enrichedRows;
}

export async function getDatabase(dbId, { workspaceScope = null } = {}) {
  const row = await prisma.databaseInstance.findUnique({ where: { id: dbId } });
  if (!row) {
    const err = new Error('Database not found');
    err.status = 404;
    throw err;
  }
  if (!isWorkspaceAccessible(row.workspaceId || null, workspaceScope)) {
    const err = new Error('Workspace access denied');
    err.status = 403;
    throw err;
  }
  return row;
}

export async function createDatabase({
  name,
  provider = 'self_hosted',
  engine = 'postgres',
  version = '16',
  region = 'us-east',
  sizeTier = 'free',
  storageGb = 10,
  computeClass = 'standard',
  workspaceId = null,
  createdByUserId
}) {
  // Simulated provision: generate connection details and mark ready.
  const database = `db_${randomUUID().slice(0, 8)}`;
  const username = `u_${randomUUID().slice(0, 6)}`;
  const password = randomUUID().replace(/-/g, '').slice(0, 24);
  const host = `${database}.internal.daxlinks`; // placeholder
  const port = 5432;

  const row = await prisma.databaseInstance.create({
    data: {
      name,
      provider,
      engine,
      version,
      region,
      sizeTier,
      storageGb,
      computeClass,
      status: 'ready',
      host,
      port,
      database,
      username,
      passwordMasked: mask(password),
      sslRequired: true,
      providerId: null,
      workspaceId,
      createdByUserId
    }
  });
  return row;
}

export async function rotateDatabaseCredentials(dbId) {
  await getDatabase(dbId);
  const newPassword = randomUUID().replace(/-/g, '').slice(0, 24);
  const updated = await prisma.databaseInstance.update({
    where: { id: dbId },
    data: {
      passwordMasked: mask(newPassword),
      updatedAt: new Date()
    }
  });
  return updated;
}

export async function deleteDatabase(dbId) {
  await getDatabase(dbId);
  await prisma.databaseInstance.delete({ where: { id: dbId } });
  return { success: true };
}

export async function listDatabaseTables(dbId, { workspaceScope = null } = {}) {
  const db = await getDatabase(dbId, { workspaceScope });
  const stats = await getTradeTableStats(resolveTradeWorkspaceScope(db, workspaceScope));

  return {
    database: {
      id: db.id,
      name: db.name,
      engine: db.engine,
      provider: db.provider
    },
    tables: [buildTradeTableDescriptor(db.id, stats)]
  };
}

export async function listTradeTransactionsForDatabase(
  dbId,
  {
    workspaceScope = null,
    symbol = null,
    botId = null,
    botInstanceId = null,
    status = null,
    from = null,
    to = null,
    limit = DEFAULT_TABLE_ROWS_LIMIT
  } = {}
) {
  const db = await getDatabase(dbId, { workspaceScope });
  const fromDate = parseDateInput(from);
  const toDate = parseDateInput(to, { endOfDayWhenDateOnly: true });
  const rowLimit = normalizeLimit(limit);
  const effectiveWorkspaceScope = resolveTradeWorkspaceScope(db, workspaceScope);

  const where = {
    ...buildWorkspaceWhere(effectiveWorkspaceScope),
    ...(toUpper(symbol) ? { symbol: toUpper(symbol) } : {}),
    ...(botId ? { botId: String(botId).trim() } : {}),
    ...(botInstanceId ? { botInstanceId: String(botInstanceId).trim() } : {}),
    ...(status ? { status: String(status).trim().toLowerCase() } : {}),
    ...(fromDate || toDate
      ? {
          executedAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {})
          }
        }
      : {})
  };

  const [total, rows] = await Promise.all([
    prisma.tradeTransaction.count({ where }),
    prisma.tradeTransaction.findMany({
      where,
      orderBy: [{ executedAt: 'desc' }, { createdAt: 'desc' }],
      take: rowLimit
    })
  ]);

  const items = rows.map((row) => mapTradeTransactionRow(row));
  const summary = items.reduce(
    (acc, row) => {
      acc.trades += 1;
      const value = asNumber(row.value);
      const quantity = asNumber(row.quantity);
      const fee = asNumber(row.feeAmount);
      const pnl = asNumber(row.realizedPnl);
      const side = String(row.side || '')
        .trim()
        .toUpperCase();
      if (value !== null) acc.totalValue += Math.abs(value);
      if (quantity !== null) acc.totalQuantity += Math.abs(quantity);
      if (fee !== null) acc.totalFees += fee;
      if (pnl !== null) acc.realizedPnl += pnl;
      if (side === 'BUY' || side === 'LONG') {
        acc.buyTrades += 1;
        if (value !== null) acc.buyValue += Math.abs(value);
      }
      if (side === 'SELL' || side === 'SHORT') {
        acc.sellTrades += 1;
        if (value !== null) acc.sellValue += Math.abs(value);
      }
      return acc;
    },
    {
      trades: 0,
      buyTrades: 0,
      sellTrades: 0,
      totalValue: 0,
      buyValue: 0,
      sellValue: 0,
      totalQuantity: 0,
      totalFees: 0,
      realizedPnl: 0
    }
  );

  return {
    database: {
      id: db.id,
      name: db.name
    },
    table: {
      key: 'trade-transactions',
      name: 'TradeTransaction'
    },
    filters: {
      workspaceScope: effectiveWorkspaceScope || null,
      symbol: toUpper(symbol),
      botId: botId || null,
      botInstanceId: botInstanceId || null,
      status: status ? String(status).trim().toLowerCase() : null,
      from: fromDate ? fromDate.toISOString() : null,
      to: toDate ? toDate.toISOString() : null,
      limit: rowLimit
    },
    total,
    returned: items.length,
    summary: {
      trades: summary.trades,
      buyTrades: summary.buyTrades,
      sellTrades: summary.sellTrades,
      totalValue: Number(summary.totalValue.toFixed(8)),
      buyValue: Number(summary.buyValue.toFixed(8)),
      sellValue: Number(summary.sellValue.toFixed(8)),
      totalQuantity: Number(summary.totalQuantity.toFixed(8)),
      totalFees: Number(summary.totalFees.toFixed(8)),
      realizedPnl: Number(summary.realizedPnl.toFixed(8))
    },
    items
  };
}
