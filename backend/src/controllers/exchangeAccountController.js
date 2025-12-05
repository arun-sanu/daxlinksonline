import { z } from 'zod';
import {
  createExchangeAccount,
  deleteExchangeAccount,
  listExchangeAccounts
} from '../services/exchangeAccountService.js';
import { recordAudit } from '../services/auditService.js';

const workspaceParamSchema = z.object({
  workspaceId: z.string().uuid()
});

const listQuerySchema = z.object({
  venue: z.string().min(2).optional()
});

const createSchema = z.object({
  name: z.string().min(2).max(80),
  venue: z.string().min(2).max(32),
  apiKey: z.string().min(4),
  apiSecret: z.string().min(4),
  passphrase: z.string().optional(),
  isSandbox: z.boolean().optional()
});

const deleteParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  exchangeAccountId: z.string().min(8)
});

export async function handleListExchangeAccounts(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const query = listQuerySchema.parse(req.query || {});
    const items = await listExchangeAccounts(workspaceId, query);
    res.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleCreateExchangeAccount(req, res, next) {
  try {
    const { workspaceId } = workspaceParamSchema.parse(req.params);
    const payload = createSchema.parse(req.body);

    const created = await createExchangeAccount(workspaceId, payload);

    console.info(
      `[exchange-accounts] created ${created.id} (${created.venue}) for workspace ${workspaceId}`
    );
    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'EXCHANGE_ACCOUNT_CREATED',
        entityType: 'Workspace',
        entityId: workspaceId,
        summary: payload.name,
        detail: { venue: payload.venue, sandbox: Boolean(payload.isSandbox) }
      });
    } catch {}

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}

export async function handleDeleteExchangeAccount(req, res, next) {
  try {
    const { workspaceId, exchangeAccountId } = deleteParamsSchema.parse({
      workspaceId: req.params.workspaceId,
      exchangeAccountId: req.params.exchangeAccountId
    });

    await deleteExchangeAccount(workspaceId, exchangeAccountId);

    console.info(
      `[exchange-accounts] deleted ${exchangeAccountId} for workspace ${workspaceId}`
    );
    try {
      await recordAudit({
        userId: req.user?.id,
        action: 'EXCHANGE_ACCOUNT_DELETED',
        entityType: 'Workspace',
        entityId: workspaceId,
        summary: exchangeAccountId
      });
    } catch {}

    res.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) error.status = 400;
    next(error);
  }
}
