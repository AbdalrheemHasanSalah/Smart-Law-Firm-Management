import { Router } from 'express';
import {
  getCurrentSession,
  getMe,
  refreshSession,
  signOut,
} from '../controllers/sessionController.js';
import { requireAuth, requireSession } from '../middleware/auth.js';
import { getPreferences, updatePreferences } from '../services/preferenceService.js';

const router = Router();

router.get('/me', requireAuth, getMe);
// A person's own server-side settings (reminder emails).
const handle = (work) => async (request, response, next) => {
  try {
    return response.status(200).json(await work(request));
  } catch (error) {
    return next(error);
  }
};
router.get('/me/preferences', requireAuth, handle((request) => getPreferences(request.user)));
router.patch('/me/preferences', requireAuth, handle((request) => updatePreferences(request.user, request.body)));
router.get('/session', requireAuth, getCurrentSession);
router.post('/session/refresh', requireAuth, refreshSession);
// Sign-out must work for any session, including one belonging to a suspended account.
router.post('/logout', requireSession, signOut);
router.post('/sign-out', requireSession, signOut);

export default router;
