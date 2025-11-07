import { Router } from 'express';
import {
  handleListIntegrations,
  handleCreateIntegration,
  handleTestIntegration,
  handleListAvailableExchanges,
  handleRenameIntegration
} from '../../controllers/integrationController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard } from '../../middleware/workspaceGuard.js';

export const router = Router({ mergeParams: true });

// Meta routes must be defined before parameterized routes
router.get('/meta/exchanges', requireAuth, handleListAvailableExchanges);

// Workspace access guard for all parameterized routes
router.use('/:workspaceId', requireAuth, guard);

router.get('/:workspaceId', requireAuth, handleListIntegrations);
router.post('/:workspaceId', requireAuth, handleCreateIntegration);
router.post('/:workspaceId/:integrationId/test', requireAuth, handleTestIntegration);
router.patch('/:workspaceId/:integrationId', requireAuth, handleRenameIntegration);
