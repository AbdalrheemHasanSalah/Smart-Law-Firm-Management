import { Router } from 'express';
import {
  createPrivateTaskController,
  createTaskController,
  deletePrivateTaskController,
  getTaskController,
  listTasksController,
  updateTaskController,
} from '../controllers/taskController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const staffRoles = ['admin', 'lawyer', 'assistant'];

router.get('/', requireAuth, requireRole(staffRoles), listTasksController);
router.post('/', requireAuth, requireRole('admin'), createTaskController);
router.post('/private', requireAuth, requireRole(staffRoles), createPrivateTaskController);
router.get('/:taskId', requireAuth, requireRole(staffRoles), getTaskController);
router.patch('/:taskId', requireAuth, requireRole(staffRoles), updateTaskController);
router.delete('/:taskId', requireAuth, requireRole(staffRoles), deletePrivateTaskController);

export default router;
