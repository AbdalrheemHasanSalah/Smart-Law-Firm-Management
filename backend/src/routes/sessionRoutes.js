import { Router } from 'express';
import {
  getCurrentSession,
  getMe,
  refreshSession,
  signOut,
} from '../controllers/sessionController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.get('/session', requireAuth, getCurrentSession);
router.post('/session/refresh', requireAuth, refreshSession);
router.post('/logout', requireAuth, signOut);
router.post('/sign-out', requireAuth, signOut);

export default router;
