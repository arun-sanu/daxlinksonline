import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { handleListUsers, handleUpdateUser } from '../../controllers/adminUsersController.js';

export const router = Router();

router.use(requireAuth, requireSuperAdmin);
router.get('/', handleListUsers);
router.patch('/:userId', handleUpdateUser);
