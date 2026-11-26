import { Router } from 'express';
import { uploadContractController } from '../controllers/contractController.js';
import {
  createClientController,
  getClientController,
  getOwnClientController,
  linkClientAccountController,
  listClientCasesController,
  listClientsController,
  updateClientController,
  updateOwnClientController,
} from '../controllers/clientController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const staffRoles = ['admin', 'lawyer', 'assistant'];

router.get('/me', requireAuth, requireRole('client'), getOwnClientController);
router.patch('/me', requireAuth, requireRole('client'), updateOwnClientController);

router.get('/', requireAuth, requireRole(staffRoles), listClientsController);
router.post('/', requireAuth, requireRole('admin'), createClientController);
router.post(
  '/:clientId/link-account',
  requireAuth,
  requireRole('admin'),
  linkClientAccountController
);
router.post(
  '/:clientId/contracts',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant']),
  uploadContractController
);
router.get(
  '/:clientId/cases',
  requireAuth,
  requireRole(['admin', 'lawyer', 'assistant', 'client']),
  listClientCasesController
);
router.get('/:clientId', requireAuth, requireRole(staffRoles), getClientController);
router.patch('/:clientId', requireAuth, requireRole(staffRoles), updateClientController);

export default router;
