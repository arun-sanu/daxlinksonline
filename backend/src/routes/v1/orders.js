import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';
import { handleGetSpotOrderSnapshot } from '../../controllers/ordersController.js';

export const router = Router({ mergeParams: true });

router.get('/:workspaceId/spot', requireAuth, workspaceGuard, handleGetSpotOrderSnapshot);
