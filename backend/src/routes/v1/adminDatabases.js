import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { handleList, handleGet, handleCreate, handleRotate, handleDelete } from '../../controllers/databaseController.js';

export const router = Router();

router.use(requireAuth);

router.get('/', handleList);
router.post('/', handleCreate);
router.get('/:dbId', handleGet);
router.post('/:dbId/rotate', handleRotate);
router.delete('/:dbId', handleDelete);

