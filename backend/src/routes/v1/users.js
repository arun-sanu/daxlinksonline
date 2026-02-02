import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { handleAssignWebhook, handleGetWebhook, handleTestWebhook } from '../../controllers/userWebhookController.js';
import { handleListWebhookAlerts } from '../../controllers/userMonitoringController.js';

export const router = Router();

router.get('/my-webhook', requireAuth, handleGetWebhook);
router.post('/assign-webhook', requireAuth, handleAssignWebhook);
router.post('/test-webhook', requireAuth, handleTestWebhook);
router.get('/webhook-alerts', requireAuth, handleListWebhookAlerts);
