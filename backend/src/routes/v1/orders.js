import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';
import {
  handleGetMyOrderReport,
  handleGetMySpotOrderSnapshot,
  handleGetSpotOrderSnapshot,
  handleGetWorkspaceOrderReport
} from '../../controllers/ordersController.js';

export const router = Router({ mergeParams: true });

router.get('/spot', requireAuth, handleGetMySpotOrderSnapshot);
router.get('/reports', requireAuth, handleGetMyOrderReport);
router.get('/:workspaceId/spot', requireAuth, workspaceGuard, handleGetSpotOrderSnapshot);
router.get('/:workspaceId/reports', requireAuth, workspaceGuard, handleGetWorkspaceOrderReport);
