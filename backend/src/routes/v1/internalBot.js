import { Router } from 'express';
import { handleGetInternalBotRuntime, handleInternalBotOrderResult } from '../../controllers/internalBotController.js';

export const router = Router();

router.get('/runtime-config/:botInstanceId', handleGetInternalBotRuntime);
router.post('/order-result', handleInternalBotOrderResult);
