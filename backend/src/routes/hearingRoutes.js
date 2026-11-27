import { Router } from 'express';
import { listCaseHearingsController, recordHearingOutcomeController } from '../controllers/hearingController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

/** A case's session log, and the outcome of each hearing (the administrator or the case team). */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];

router.get('/', ...staff, listCaseHearingsController);
router.post('/:hearingId/outcome', ...staff, recordHearingOutcomeController);

export default router;
