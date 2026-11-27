import { Router } from 'express';
import {
  attachPowerOfAttorneyScanController,
  createPowerOfAttorneyController,
  downloadPowerOfAttorneyScanController,
  getPowerOfAttorneyController,
  listAuthorizableLawyersController,
  listPowersOfAttorneyController,
  updatePowerOfAttorneyController,
} from '../controllers/powerOfAttorneyController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

/** Powers of attorney: staff record and maintain them; a client reads their own. */
const router = Router();
const readers = [requireAuth, requireRole(['admin', 'lawyer', 'assistant', 'client'])];
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const uploadLimit = createRateLimit({ maxRequests: 20 });

router.get('/', ...readers, listPowersOfAttorneyController);
router.post('/', ...staff, createPowerOfAttorneyController);
router.get('/lawyers', ...staff, listAuthorizableLawyersController);
router.get('/:poaId/scan', ...readers, downloadPowerOfAttorneyScanController);
router.put('/:poaId/scan', uploadLimit, ...staff, attachPowerOfAttorneyScanController);
router.get('/:poaId', ...readers, getPowerOfAttorneyController);
router.patch('/:poaId', ...staff, updatePowerOfAttorneyController);

export default router;
