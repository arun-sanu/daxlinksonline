import { z } from 'zod';
import {
  listDatabases,
  getDatabase,
  listDatabaseTables,
  listTradeTransactionsForDatabase,
  createDatabase,
  rotateDatabaseCredentials,
  deleteDatabase
} from '../services/databaseService.js';
import { prisma } from '../utils/prisma.js';

const createSchema = z.object({
  name: z.string().min(2),
  provider: z.string().default('self_hosted'),
  engine: z.string().default('postgres'),
  version: z.string().default('16'),
  region: z.string().default('us-east'),
  sizeTier: z.string().default('free'),
  storageGb: z.number().int().positive().default(10),
  computeClass: z.string().default('standard'),
  workspaceId: z.string().uuid().nullable().optional()
});

const getDatabaseQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeTables: z.coerce.boolean().default(true)
});

const listDatabaseQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  includeTables: z.coerce.boolean().default(true)
});

const tablesQuerySchema = z.object({
  workspaceId: z.string().uuid().optional()
});

const tradeTransactionsQuerySchema = z.object({
  workspaceId: z.string().uuid().optional(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/)
    .optional(),
  botId: z.string().trim().min(1).max(64).optional(),
  botInstanceId: z.string().trim().min(1).max(64).optional(),
  status: z.string().trim().max(64).optional(),
  from: z.string().trim().max(64).optional(),
  to: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

async function resolveWorkspaceScope(req, requestedWorkspaceId = null) {
  if (req.user?.isSuperAdmin) {
    return requestedWorkspaceId || null;
  }

  const rows = await prisma.workspace.findMany({
    where: { ownerId: req.user?.id || '' },
    select: { id: true }
  });
  const ids = rows.map((row) => row.id);

  if (requestedWorkspaceId && !ids.includes(requestedWorkspaceId)) {
    const error = new Error('Workspace access denied');
    error.status = 403;
    throw error;
  }

  if (requestedWorkspaceId) return requestedWorkspaceId;
  return ids;
}

export async function handleList(req, res, next) {
  try {
    const { workspaceId, includeTables } = listDatabaseQuerySchema.parse(req.query || {});
    const workspaceScope = await resolveWorkspaceScope(req, workspaceId || null);
    const rows = await listDatabases();

    if (!includeTables) {
      return res.json(rows);
    }

    const tableStub = {
      key: 'trade-transactions',
      name: 'TradeTransaction',
      purpose: 'Bot trade ledger for compounding, amount/quantity/value math, and PnL analytics'
    };

    const filteredRows = req.user?.isSuperAdmin
      ? rows
      : rows.filter((row) => {
          if (workspaceScope === null) return true;
          if (Array.isArray(workspaceScope)) return workspaceScope.includes(row.workspaceId);
          return row.workspaceId === workspaceScope;
        });

    res.json(
      filteredRows.map((row) => ({
        ...row,
        tables: [tableStub]
      }))
    );
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleGet(req, res, next) {
  try {
    const { workspaceId, includeTables } = getDatabaseQuerySchema.parse(req.query || {});
    const workspaceScope = await resolveWorkspaceScope(req, workspaceId || null);
    const row = await getDatabase(req.params.dbId);
    const isAccessible = req.user?.isSuperAdmin || workspaceScope === null || (Array.isArray(workspaceScope)
      ? workspaceScope.includes(row.workspaceId)
      : row.workspaceId === workspaceScope);
    if (!isAccessible) {
      return res.status(403).json({ error: 'Workspace access denied' });
    }

    if (!includeTables) {
      return res.json(row);
    }

    const payload = await listDatabaseTables(req.params.dbId, { workspaceScope });
    res.json({
      ...row,
      tables: payload.tables
    });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleListTables(req, res, next) {
  try {
    const { workspaceId } = tablesQuerySchema.parse(req.query || {});
    const workspaceScope = await resolveWorkspaceScope(req, workspaceId || null);
    const payload = await listDatabaseTables(req.params.dbId, { workspaceScope });
    res.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleListTradeTransactions(req, res, next) {
  try {
    const {
      workspaceId,
      symbol,
      botId,
      botInstanceId,
      status,
      from,
      to,
      limit
    } = tradeTransactionsQuerySchema.parse(req.query || {});

    const workspaceScope = await resolveWorkspaceScope(req, workspaceId || null);
    const payload = await listTradeTransactionsForDatabase(req.params.dbId, {
      workspaceScope,
      symbol,
      botId,
      botInstanceId,
      status,
      from,
      to,
      limit
    });
    res.json(payload);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreate(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const payload = createSchema.parse(req.body);
    const row = await createDatabase({ ...payload, createdByUserId: req.user.id });
    try {
      const { recordAudit } = await import('../services/auditService.js');
      await recordAudit({ userId: req.user.id, action: 'db.create', entityType: 'DatabaseInstance', entityId: row.id, summary: row.name });
    } catch {}
    res.status(201).json(row);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleRotate(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const row = await rotateDatabaseCredentials(req.params.dbId);
    try {
      const { recordAudit } = await import('../services/auditService.js');
      await recordAudit({ userId: req.user.id, action: 'db.rotate', entityType: 'DatabaseInstance', entityId: row.id, summary: row.name });
    } catch {}
    res.json(row);
  } catch (error) {
    next(error);
  }
}

export async function handleDelete(req, res, next) {
  try {
    if (!req.user?.isSuperAdmin) {
      return res.status(403).json({ error: 'Super admin required' });
    }
    const result = await deleteDatabase(req.params.dbId);
    try {
      const { recordAudit } = await import('../services/auditService.js');
      await recordAudit({ userId: req.user.id, action: 'db.delete', entityType: 'DatabaseInstance', entityId: req.params.dbId, summary: 'Deleted database' });
    } catch {}
    res.json(result);
  } catch (error) {
    next(error);
  }
}
