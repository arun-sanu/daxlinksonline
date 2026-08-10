import { Router } from 'express';
import {
  handleListWebhooks,
  handleCreateWebhook,
  handleToggleWebhook
} from '../../controllers/webhookController.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router({ mergeParams: true });

router.get('/:workspaceId', requireAuth, handleListWebhooks);
router.post('/:workspaceId', requireAuth, handleCreateWebhook);
router.patch('/:workspaceId/:webhookId', requireAuth, handleToggleWebhook);
