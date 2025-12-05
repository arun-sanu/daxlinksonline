import { Router } from 'express';
import {
  handleCreateExchangeAccount,
  handleDeleteExchangeAccount,
  handleListExchangeAccounts
} from '../../controllers/exchangeAccountController.js';
import { requireAuth } from '../../middleware/auth.js';
import { guard } from '../../middleware/workspaceGuard.js';

export const router = Router({ mergeParams: true });

router.use('/:workspaceId', requireAuth, guard);

router.get('/:workspaceId/exchange-accounts', handleListExchangeAccounts);
router.post('/:workspaceId/exchange-accounts', handleCreateExchangeAccount);
router.delete('/:workspaceId/exchange-accounts/:exchangeAccountId', handleDeleteExchangeAccount);
