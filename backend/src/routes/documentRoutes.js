import { Router } from 'express';
import {
  downloadDocumentController,
  getDocumentController,
  listDocumentsController,
  updateDocumentController,
} from '../controllers/documentController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const readableRoles = ['admin', 'lawyer', 'assistant', 'client'];
const editableRoles = ['admin', 'lawyer', 'assistant'];

router.get('/', requireAuth, requireRole(readableRoles), listDocumentsController);
router.get(
  '/:documentId/download',
  requireAuth,
  requireRole(readableRoles),
  downloadDocumentController
);
router.get(
  '/:documentId',
  requireAuth,
  requireRole(readableRoles),
  getDocumentController
);
router.patch(
  '/:documentId',
  requireAuth,
  requireRole(editableRoles),
  updateDocumentController
);

export default router;
