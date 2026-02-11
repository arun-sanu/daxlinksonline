import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { handleAssignWebhook, handleGetWebhook, handleTestWebhook, handleUpdateDnsOrder } from '../../controllers/userWebhookController.js';
import { handleDeleteWebhookAlerts, handleListWebhookAlerts } from '../../controllers/userMonitoringController.js';

export const router = Router();

router.get('/my-webhook', requireAuth, handleGetWebhook);
router.get('/alerts', requireAuth, handleListWebhookAlerts);
router.get('/webhook-alerts', requireAuth, handleListWebhookAlerts);
router.delete('/alerts', requireAuth, handleDeleteWebhookAlerts);
router.delete('/webhook-alerts', requireAuth, handleDeleteWebhookAlerts);
router.post('/assign-webhook', requireAuth, handleAssignWebhook);
router.put('/dns-order', requireAuth, handleUpdateDnsOrder);
router.post('/test-webhook', requireAuth, handleTestWebhook);
