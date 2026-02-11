import { z } from 'zod';
import { getMexcSpotSnapshot } from '../services/ordersService.js';

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
  origClientOrderId: z.string().trim().max(64).optional()
});

export async function handleGetSpotOrderSnapshot(req, res, next) {
  try {
    const { workspaceId } = paramsSchema.parse(req.params);
    const { integrationId, symbol, orderId, origClientOrderId } = querySchema.parse(req.query || {});

    const snapshot = await getMexcSpotSnapshot({
      workspaceId,
      integrationId,
      symbol,
      orderId,
      origClientOrderId
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
