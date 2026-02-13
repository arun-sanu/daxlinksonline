import { Router } from 'express';
import multer from 'multer';
import {
  handleCreateExchangeAccount,
  handleDeleteExchangeAccount,
  handleListExchangeAccounts
} from '../../controllers/exchangeAccountController.js';
import {
  handleCreateTradeBot,
  handleCreateTradeBotInstance,
  handleCreateTradeBotWithUpload,
  handleGetTradeBot,
  handleGetTradeBotMonitoring,
  handleGetTradeBotWorkflowLink,
  handleListTradeBotInstances,
  handleListTradeBotLanguages,
  handleListTradeBotOrders,
  handleListTradeBots,
  handleUploadTradeBotVersion
} from '../../controllers/tradeBotsController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard } from '../../middleware/workspaceGuard.js';

export const router = Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.BOT_ZIP_LIMIT_MB || 8) * 1024 * 1024
  }
});

router.get('/meta/languages', requireAuth, handleListTradeBotLanguages);

router.use('/:workspaceId', requireAuth, guard);

router.get('/:workspaceId/exchange-accounts', handleListExchangeAccounts);
router.post('/:workspaceId/exchange-accounts', handleCreateExchangeAccount);
router.delete('/:workspaceId/exchange-accounts/:exchangeAccountId', handleDeleteExchangeAccount);

router.get('/:workspaceId/bots', handleListTradeBots);
router.post('/:workspaceId/bots', handleCreateTradeBot);
router.post('/:workspaceId/bots/upload', upload.single('file'), handleCreateTradeBotWithUpload);
router.get('/:workspaceId/bots/:botId', handleGetTradeBot);
router.post('/:workspaceId/bots/:botId/versions/upload', upload.single('file'), handleUploadTradeBotVersion);
router.get('/:workspaceId/bots/:botId/instances', handleListTradeBotInstances);
router.post('/:workspaceId/bots/:botId/instances', handleCreateTradeBotInstance);
router.get('/:workspaceId/bots/:botId/orders', handleListTradeBotOrders);
router.get('/:workspaceId/bots/:botId/monitoring', handleGetTradeBotMonitoring);
router.get('/:workspaceId/bots/:botId/workflow', handleGetTradeBotWorkflowLink);
