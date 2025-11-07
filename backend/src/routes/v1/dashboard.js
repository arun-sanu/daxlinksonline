import { Router } from 'express';
import { handleBootstrap } from '../../controllers/dashboardController.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router({ mergeParams: true });

router.get('/:workspaceId/bootstrap', requireAuth, handleBootstrap);
