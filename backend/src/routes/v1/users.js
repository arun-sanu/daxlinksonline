import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { handleAssignWebhook, handleGetWebhook, handleTestWebhook } from '../../controllers/userWebhookController.js';

export const router = Router();

router.get('/my-webhook', requireAuth, handleGetWebhook);
router.post('/assign-webhook', requireAuth, handleAssignWebhook);
router.post('/test-webhook', requireAuth, handleTestWebhook);
