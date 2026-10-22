import { Router } from 'express';
import {
  createTaskController,
  getTaskController,
  listTasksController,
  updateTaskController,
} from '../controllers/taskController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const staffRoles = ['admin', 'lawyer', 'assistant'];

router.get('/', requireAuth, requireRole(staffRoles), listTasksController);
router.post('/', requireAuth, requireRole('admin'), createTaskController);
router.get('/:taskId', requireAuth, requireRole(staffRoles), getTaskController);
router.patch('/:taskId', requireAuth, requireRole(staffRoles), updateTaskController);

export default router;
