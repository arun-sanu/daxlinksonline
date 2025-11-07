import { Router } from 'express';
import { handleCreateWorkspace } from '../../controllers/workspaceController.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router();

router.post('/', requireAuth, handleCreateWorkspace);
