import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  handleGetSizingRecent,
  handleGetSizingSummary,
  handleGetSizingAudit
} from '../controllers/sizingController.js';

export const sizingRouter = Router();

sizingRouter.get('/recent', requireAuth, handleGetSizingRecent);
sizingRouter.get('/reports/summary', requireAuth, handleGetSizingSummary);
sizingRouter.get('/audit/:id', requireAuth, handleGetSizingAudit);
