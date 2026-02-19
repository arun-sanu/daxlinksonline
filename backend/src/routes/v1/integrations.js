import { Router } from 'express';
import {
  handleListIntegrations,
  handleCreateIntegration,
  handleTestIntegration,
  handleIntegrationsStream,
  handleListAvailableExchanges,
  handleRenameIntegration,
  handleControlIntegration,
  handleGetIntegrationDetail,
  handleCreateIntegrationCredential,
  handleUpdateIntegrationCredential,
  handleDeleteIntegrationCredential,
  handlePurgeIntegrationCredentials,
  handleDeleteIntegration
} from '../../controllers/integrationController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard } from '../../middleware/workspaceGuard.js';

export const router = Router({ mergeParams: true });

function injectBearerFromQuery(req, _res, next) {
  const hasAuthHeader = typeof req.headers.authorization === 'string' && req.headers.authorization.trim().length > 0;
  const token = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
  if (!hasAuthHeader && token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  next();
}

// Delete an entire integration (and its credentials)
router.delete('/:workspaceId/:integrationId', requireAuth, handleDeleteIntegration);

// Meta routes must be defined before parameterized routes
router.get('/meta/exchanges', requireAuth, handleListAvailableExchanges);

// Workspace access guard for all parameterized routes
router.use('/:workspaceId', requireAuth, guard);

router.get('/:workspaceId', requireAuth, handleListIntegrations);
router.post('/:workspaceId', requireAuth, handleCreateIntegration);
router.get('/:workspaceId/stream', injectBearerFromQuery, requireAuth, handleIntegrationsStream);
router.get('/:workspaceId/:integrationId', requireAuth, handleGetIntegrationDetail);
router.post('/:workspaceId/:integrationId/test', requireAuth, handleTestIntegration);
router.patch('/:workspaceId/:integrationId', requireAuth, handleRenameIntegration);
router.post('/:workspaceId/:integrationId/actions/:action', requireAuth, handleControlIntegration);
router.delete('/:workspaceId/:integrationId', requireAuth, handleDeleteIntegration);
router.post('/:workspaceId/:integrationId/credentials', requireAuth, handleCreateIntegrationCredential);
router.delete('/:workspaceId/:integrationId/credentials', requireAuth, handlePurgeIntegrationCredentials);
router.put('/:workspaceId/:integrationId/credentials/:credentialId', requireAuth, handleUpdateIntegrationCredential);
router.delete('/:workspaceId/:integrationId/credentials/:credentialId', requireAuth, handleDeleteIntegrationCredential);
