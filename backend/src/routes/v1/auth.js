import { Router } from 'express';
import {
  handleRegisterDisabled,
  handleLogin,
  handleCurrentUser,
  handleForgotPassword,
  handleResetPassword
} from '../../controllers/authController.js';
import { requireAuth } from '../../middleware/auth.js';

export const router = Router();

router.post('/register', handleRegisterDisabled);
router.post('/login', handleLogin);
router.post('/forgot', handleForgotPassword);
router.post('/reset', handleResetPassword);
router.get('/me', requireAuth, handleCurrentUser);
