import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { guard as workspaceGuard } from '../../middleware/workspaceGuard.js';
import {
  handleGetMyCompoundingReport,
  handleGetMyOrderReport,
  handleGetMySpotOrderSnapshot,
  handleGetMyTradeTransactions,
  handleGetWorkspaceCompoundingReport,
  handleGetSpotOrderSnapshot,
  handleGetWorkspaceOrderReport,
  handleGetWorkspaceTradeTransactions
} from '../../controllers/ordersController.js';

export const router = Router({ mergeParams: true });

router.get('/spot', requireAuth, handleGetMySpotOrderSnapshot);
router.get('/reports', requireAuth, handleGetMyOrderReport);
router.get('/trade-transactions', requireAuth, handleGetMyTradeTransactions);
router.get('/compounding', requireAuth, handleGetMyCompoundingReport);
router.get('/:workspaceId/spot', requireAuth, workspaceGuard, handleGetSpotOrderSnapshot);
router.get('/:workspaceId/reports', requireAuth, workspaceGuard, handleGetWorkspaceOrderReport);
router.get('/:workspaceId/trade-transactions', requireAuth, workspaceGuard, handleGetWorkspaceTradeTransactions);
router.get('/:workspaceId/compounding', requireAuth, workspaceGuard, handleGetWorkspaceCompoundingReport);
