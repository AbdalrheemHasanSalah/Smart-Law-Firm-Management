import { Router } from 'express';
import {
  getCurrentSession,
  getMe,
  refreshSession,
  signOut,
} from '../controllers/sessionController.js';
import { requireAuth, requireSession } from '../middleware/auth.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.get('/session', requireAuth, getCurrentSession);
router.post('/session/refresh', requireAuth, refreshSession);
// Sign-out must work for any session, including one belonging to a suspended account.
router.post('/logout', requireSession, signOut);
router.post('/sign-out', requireSession, signOut);

export default router;
