import { Router } from 'express';
import {
  downloadDocumentController,
  getDocumentController,
  listDocumentsController,
  updateDocumentController,
} from '../controllers/documentController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { setDocumentSharing } from '../services/documentSharingService.js';

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
// Share an uploaded document with a client of its case, or stop sharing it.
router.post('/:documentId/sharing', requireAuth, requireRole(editableRoles), async (request, response, next) => {
  try {
    return response.status(200).json(await setDocumentSharing(request.user, request.params.documentId, request.body));
  } catch (error) {
    return next(error);
  }
});

export default router;
