import { z } from 'zod';
import { getMexcSpotSnapshot, getWorkspaceOrderReport } from '../services/ordersService.js';
import { prisma } from '../utils/prisma.js';

const paramsSchema = z.object({
  workspaceId: z.string().uuid()
});

const querySchema = z.object({
  integrationId: z.string().uuid().optional(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/)
    .optional(),
  orderId: z.union([z.string(), z.number()]).optional(),
  origClientOrderId: z.string().trim().max(64).optional(),
  interval: z.string().trim().max(12).optional(),
  atrLength: z.coerce.number().int().min(2).max(200).optional()
});

const reportQuerySchema = z.object({
  integrationId: z.string().uuid().optional(),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{4,20}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export async function handleGetSpotOrderSnapshot(req, res, next) {
  try {
    const { workspaceId } = paramsSchema.parse(req.params);
    const { integrationId, symbol, orderId, origClientOrderId, interval, atrLength } = querySchema.parse(req.query || {});

    const snapshot = await getMexcSpotSnapshot({
      workspaceId,
      integrationId,
      symbol,
      orderId,
      origClientOrderId,
      interval,
      atrLength
    });
    res.json(snapshot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}

const myQuerySchema = querySchema.extend({
  workspaceId: z.string().uuid().optional()
});

const myReportQuerySchema = reportQuerySchema.extend({
  workspaceId: z.string().uuid().optional()
});

async function resolveWorkspaceForUser(userId, workspaceId) {
  const row = await prisma.workspace.findFirst({
    where: {
      ownerId: userId,
      ...(workspaceId ? { id: workspaceId } : {})
    },
    select: { id: true }
  });
  if (!row) {
    throw Object.assign(new Error('Workspace not found for current user'), { status: 404 });
  }
  return row.id;
}

export async function handleGetMySpotOrderSnapshot(req, res, next) {
  try {
    const { integrationId, symbol, orderId, origClientOrderId, interval, atrLength, workspaceId } = myQuerySchema.parse(req.query || {});
    const resolvedWorkspaceId = await resolveWorkspaceForUser(req.user.id, workspaceId);
    const snapshot = await getMexcSpotSnapshot({
      workspaceId: resolvedWorkspaceId,
      integrationId,
      symbol,
      orderId,
      origClientOrderId,
      interval,
      atrLength
    });
    res.json(snapshot);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}

export async function handleGetWorkspaceOrderReport(req, res, next) {
  try {
    const { workspaceId } = paramsSchema.parse(req.params);
    const { integrationId, symbol, limit } = reportQuerySchema.parse(req.query || {});
    const report = await getWorkspaceOrderReport({
      workspaceId,
      integrationId,
      symbol,
      limit
    });
    res.json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}

export async function handleGetMyOrderReport(req, res, next) {
  try {
    const { integrationId, symbol, limit, workspaceId } = myReportQuerySchema.parse(req.query || {});
    const resolvedWorkspaceId = await resolveWorkspaceForUser(req.user.id, workspaceId);
    const report = await getWorkspaceOrderReport({
      workspaceId: resolvedWorkspaceId,
      integrationId,
      symbol,
      limit
    });
    res.json(report);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid query parameters';
    }
    next(error);
  }
}
