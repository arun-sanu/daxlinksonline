import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { handleListSecrets, handleCreateSecret, handleDeleteSecret, handleRotateSecret, handleRevealSecret } from '../../controllers/adminSecretsController.js';

export const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/', handleListSecrets);
router.post('/', handleCreateSecret);
router.delete('/:secretId', handleDeleteSecret);
router.post('/:secretId/rotate', handleRotateSecret);
router.post('/:secretId/reveal', handleRevealSecret);
