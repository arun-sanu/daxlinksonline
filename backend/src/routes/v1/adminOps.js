import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { handleQueuesSummary, handleListFlags, handleUpdateFlag, handleListAudit, handleReplayWebhook, handleListDeliveries, handleBulkRotateDatabases, handleBulkToggleWebhooks, handleSendTestEvent, handleEvaluateFlag, handleRetryDelivery, handleRetryFailedForWebhook, handleRetryFailedForWorkspace, handleDeliveryStats } from '../../controllers/adminOpsController.js';

export const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/queues/summary', handleQueuesSummary);
router.get('/flags', handleListFlags);
router.put('/flags/:key', handleUpdateFlag);
router.get('/flags/:key/evaluate', handleEvaluateFlag);
router.get('/audit', handleListAudit);
router.post('/webhooks/:workspaceId/:webhookId/replay', handleReplayWebhook);
router.post('/webhooks/:workspaceId/test-event', handleSendTestEvent);
router.post('/deliveries/:deliveryId/retry', handleRetryDelivery);
router.post('/webhooks/:workspaceId/:webhookId/retry-failed', handleRetryFailedForWebhook);
router.post('/webhooks/:workspaceId/retry-failed', handleRetryFailedForWorkspace);
router.get('/deliveries', handleListDeliveries);
router.get('/deliveries/stats', handleDeliveryStats);
router.post('/databases/rotate-all', handleBulkRotateDatabases);
router.post('/webhooks/:workspaceId/bulk', handleBulkToggleWebhooks); // ?action=enable|disable
