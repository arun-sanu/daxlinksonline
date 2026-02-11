import { Router } from 'express';

import { router as dashboardRouter } from './v1/dashboard.js';
import { router as workspaceRouter } from './v1/workspaces.js';
import { router as integrationRouter } from './v1/integrations.js';
import { router as webhookRouter } from './v1/webhooks.js';
import { router as authRouter } from './v1/auth.js';
import { router as adminDbRouter } from './v1/adminDatabases.js';
import { router as adminOpsRouter } from './v1/adminOps.js';
import { router as adminUsersRouter } from './v1/adminUsers.js';
import { router as adminSecretsRouter } from './v1/adminSecrets.js';
import { router as adminIncidentsRouter } from './v1/adminIncidents.js';
import { router as ingressRouter } from './v1/ingress.js';
import { router as dnsRouter } from './v1/dns.js';
import { router as adminQueuesRouter } from './v1/adminQueues.js';
import { router as adminIngressRouter } from './v1/adminIngress.js';
import { router as portalRouter } from './v1/portal.js';
import { devicesRouter } from './devices.js';
import { notifyPrefsRouter } from './notifyPrefs.js';
import { notifyDebugRouter } from './notifyDebug.js';
// Trade Bots Phase 0 routes
import { notifyInboxRouter } from './notifyInbox.js';
import { router as workflowRouter } from './v1/workflow.js';
import { router as tradeBotsRouter } from './v1/tradeBots.js';
import { router as usersRouter } from './v1/users.js';
import { router as metricsRouter } from './v1/metrics.js';
import { router as ordersRouter } from './v1/orders.js';

export const router = Router();

router.use('/v1/dashboard', dashboardRouter);
router.use('/v1/workspaces', workspaceRouter);
router.use('/v1/integrations', integrationRouter);
router.use('/v1/webhooks', webhookRouter);
router.use('/v1/auth', authRouter);
router.use('/v1/admin/databases', adminDbRouter);
router.use('/v1/admin', adminOpsRouter);
router.use('/v1/admin/users', adminUsersRouter);
router.use('/v1/admin/secrets', adminSecretsRouter);
router.use('/v1/admin/incidents', adminIncidentsRouter);
router.use('/v1/admin/queues', adminQueuesRouter);
router.use('/v1/admin/ingress', adminIngressRouter);
router.use('/v1/portal', portalRouter);
router.use('/v1', ingressRouter);
router.use('/v1/dns', dnsRouter);
router.use('/v1/devices', devicesRouter);
router.use('/v1/notify/preferences', notifyPrefsRouter);
router.use('/v1/notify', notifyInboxRouter);
router.use('/debug', notifyDebugRouter);
router.use('/v1/workflow', workflowRouter);
router.use('/v1/trade-bots', tradeBotsRouter);
router.use('/v1/users', usersRouter);
router.use('/v1/metrics', metricsRouter);
router.use('/v1/orders', ordersRouter);
// Phase 0 mounts for Trade Bots

router.get('/v1/metadata', (_req, res) => {
  res.json({
    name: 'DaxLinks Backend API',
    version: '0.1.0'
  });
});
