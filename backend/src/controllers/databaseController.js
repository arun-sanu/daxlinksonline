import { z } from 'zod';
import {
  listDatabases,
  getDatabase,
  createDatabase,
  rotateDatabaseCredentials,
  deleteDatabase
} from '../services/databaseService.js';

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

export async function handleList(req, res, next) {
  try {
    const rows = await listDatabases();
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

export async function handleGet(req, res, next) {
  try {
    const row = await getDatabase(req.params.dbId);
    res.json(row);
  } catch (error) {
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
