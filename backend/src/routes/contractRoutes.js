import { Router } from 'express';
import {
  downloadContractController,
  getContractController,
  listContractsController,
  updateContractController,
} from '../controllers/contractController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const readableRoles = ['admin', 'lawyer', 'assistant', 'client'];
const editableRoles = ['admin', 'lawyer', 'assistant'];

router.get('/', requireAuth, requireRole(readableRoles), listContractsController);
router.get(
  '/:contractId/download',
  requireAuth,
  requireRole(readableRoles),
  downloadContractController
);
router.get(
  '/:contractId',
  requireAuth,
  requireRole(readableRoles),
  getContractController
);
router.patch(
  '/:contractId',
  requireAuth,
  requireRole(editableRoles),
  updateContractController
);

export default router;
