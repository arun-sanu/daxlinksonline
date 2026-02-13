import { Router } from 'express';
import { handleInternalBotOrderResult } from '../../controllers/internalBotController.js';

export const router = Router();

router.post('/order-result', handleInternalBotOrderResult);
