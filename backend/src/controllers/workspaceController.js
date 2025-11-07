import { z } from 'zod';
import { createWorkspace } from '../services/workspaceService.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(2),
  slug: z.string().optional(),
  planTier: z.string(),
  teamSize: z.string(),
  primaryUseCase: z.string(),
  region: z.string(),
  adminLocation: z.string().optional(),
  adminDevice: z.string().optional(),
  adminIp: z.string().optional()
});

export async function handleCreateWorkspace(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const payload = createWorkspaceSchema.parse(req.body);
    const workspace = await createWorkspace(payload, req.user.id);
    res.status(201).json(workspace);
  } catch (error) {
    if (error instanceof z.ZodError) {
      error.status = 400;
    }
    next(error);
  }
}
