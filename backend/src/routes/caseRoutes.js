import { Router } from 'express';
import {
  assignStaffToCaseController,
  removeStaffFromCaseController,
  createCaseController,
  getCaseController,
  getCaseRelationshipsController,
  linkClientToCaseController,
  listCasesController,
  updateCaseController,
} from '../controllers/caseController.js';
import { uploadDocumentController } from '../controllers/documentController.js';
import {
  createCaseNoteController,
  listCaseNotesController,
} from '../controllers/caseNoteController.js';
import {
  addOpponentController,
  listOpponentsController,
  removeOpponentController,
} from '../controllers/conflictController.js';
import {
  generateHearingPrepController,
  listHearingPrepsController,
} from '../controllers/hearingPrepController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

// Each sheet is a paid model call: a few per user per window is plenty.
const hearingPrepLimit = createRateLimit({ maxRequests: 10 });

const router = Router();
const readableRoles = ['admin', 'lawyer', 'assistant', 'client'];
const editableRoles = ['admin', 'lawyer', 'assistant'];

router.get('/', requireAuth, requireRole(readableRoles), listCasesController);
router.post('/', requireAuth, requireRole('admin'), createCaseController);
router.get(
  '/:caseId/notes',
  requireAuth,
  requireRole(readableRoles),
  listCaseNotesController
);
router.post(
  '/:caseId/notes',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant']),
  createCaseNoteController
);
router.get('/:caseId/relationships', requireAuth, requireRole(readableRoles), getCaseRelationshipsController);
router.post('/:caseId/clients', requireAuth, requireRole('admin'), linkClientToCaseController);
router.get('/:caseId/opponents', requireAuth, requireRole(editableRoles), listOpponentsController);
router.post('/:caseId/opponents', requireAuth, requireRole('admin'), addOpponentController);
router.delete('/:caseId/opponents/:opponentId', requireAuth, requireRole('admin'), removeOpponentController);
router.get('/:caseId/hearing-prep', requireAuth, requireRole(editableRoles), listHearingPrepsController);
router.post('/:caseId/hearing-prep', hearingPrepLimit, requireAuth, requireRole(editableRoles), generateHearingPrepController);
router.post('/:caseId/assignments', requireAuth, requireRole('admin'), assignStaffToCaseController);
router.delete('/:caseId/assignments/:userId', requireAuth, requireRole('admin'), removeStaffFromCaseController);
router.post(
  '/:caseId/documents',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant']),
  uploadDocumentController
);
router.get('/:caseId', requireAuth, requireRole(readableRoles), getCaseController);
router.patch('/:caseId', requireAuth, requireRole(editableRoles), updateCaseController);

export default router;
