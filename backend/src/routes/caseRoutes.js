import { Router } from 'express';
import {
  assignStaffToCaseController,
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
import { requireAuth, requireRole } from '../middleware/auth.js';

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
router.post('/:caseId/assignments', requireAuth, requireRole('admin'), assignStaffToCaseController);
router.post(
  '/:caseId/documents',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant']),
  uploadDocumentController
);
router.get('/:caseId', requireAuth, requireRole(readableRoles), getCaseController);
router.patch('/:caseId', requireAuth, requireRole(editableRoles), updateCaseController);

export default router;
