import { Router } from 'express';
import {
  getUserController,
  listUsersController,
  updateUserRoleController,
  updateUserStatusController,
} from '../controllers/userController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));
router.get('/', listUsersController);
router.get('/:userId', getUserController);
router.patch('/:userId/role', updateUserRoleController);
router.patch('/:userId/status', updateUserStatusController);

export default router;
