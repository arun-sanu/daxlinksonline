import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { handleMonitoringMetrics, handleConnectivityMetrics } from '../../controllers/metricsController.js';

export const router = Router();

router.get('/monitoring', requireAuth, handleMonitoringMetrics);
router.get('/connectivity', requireAuth, handleConnectivityMetrics);
