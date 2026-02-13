import { z } from 'zod';
import { getSizingReportById, listSizingReports } from '../services/botSizingReportsService.js';

const querySchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9/_-]{4,30}$/)
    .optional(),
  strategy: z.string().trim().max(120).optional(),
  status: z.string().trim().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  workspaceId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const paramsSchema = z.object({
  id: z.string().min(8)
});

export async function handleListAdminSizingReports(req, res, next) {
  try {
    const query = querySchema.parse(req.query || {});
    const result = await listSizingReports({
      symbol: query.symbol,
      strategy: query.strategy,
      status: query.status,
      from: query.from,
      to: query.to,
      workspaceId: query.workspaceId,
      page: query.page,
      limit: query.limit
    });
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid sizing report filters';
    }
    next(error);
  }
}

export async function handleGetAdminSizingReport(req, res, next) {
  try {
    const { id } = paramsSchema.parse(req.params || {});
    const result = await getSizingReportById(id);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
      error.message = 'Invalid sizing report id';
    }
    next(error);
  }
}
