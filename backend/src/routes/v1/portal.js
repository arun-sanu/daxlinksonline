import { Router } from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { handlePortalLogin, handlePortalCreateUser, handlePortalAssignRole, handlePortalSetPassword } from '../../controllers/portalController.js';

export const router = Router();

// Secret portal authentication for privileged roles
router.post('/login', handlePortalLogin);

// Superadmin-only user management
router.use(requireAuth, requireSuperAdmin);
router.post('/users', handlePortalCreateUser);
router.patch('/users/:userId/role', handlePortalAssignRole);
router.post('/users/:userId/password', handlePortalSetPassword);

