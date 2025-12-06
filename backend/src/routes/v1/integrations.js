import { Router } from 'express';
import {
  handleListIntegrations,
  handleCreateIntegration,
  handleTestIntegration,
  handleListAvailableExchanges,
  handleRenameIntegration,
  handleGetIntegrationDetail,
  handleUpdateIntegrationCredential,
  handleDeleteIntegrationCredential
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
router.get('/:workspaceId/:integrationId', requireAuth, handleGetIntegrationDetail);
router.post('/:workspaceId/:integrationId/test', requireAuth, handleTestIntegration);
router.patch('/:workspaceId/:integrationId', requireAuth, handleRenameIntegration);
router.put('/:workspaceId/:integrationId/credentials/:credentialId', requireAuth, handleUpdateIntegrationCredential);
router.delete('/:workspaceId/:integrationId/credentials/:credentialId', requireAuth, handleDeleteIntegrationCredential);
