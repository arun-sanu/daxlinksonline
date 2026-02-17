import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  handleList,
  handleGet,
  handleListTables,
  handleListTradeTransactions,
  handleCreate,
  handleRotate,
  handleDelete
} from '../../controllers/databaseController.js';

export const router = Router();

router.use(requireAuth);

router.get('/', handleList);
router.post('/', handleCreate);
router.get('/:dbId', handleGet);
router.get('/:dbId/tables', handleListTables);
router.get('/:dbId/tables/trade-transactions', handleListTradeTransactions);
router.post('/:dbId/rotate', handleRotate);
router.delete('/:dbId', handleDelete);
