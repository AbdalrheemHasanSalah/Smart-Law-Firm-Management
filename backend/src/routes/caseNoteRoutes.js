import { Router } from 'express';
import {
  updateCaseNoteController,
} from '../controllers/caseNoteController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.patch(
  '/:noteId',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant']),
  updateCaseNoteController
);

export default router;
