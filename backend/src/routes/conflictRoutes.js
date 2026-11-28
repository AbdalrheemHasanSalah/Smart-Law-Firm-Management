import { Router } from 'express';
import { checkConflictsController, listAuditLogController, verifyAuditChainController } from '../controllers/conflictController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/conflicts/check', requireAuth, requireRole('admin'), checkConflictsController);
router.get('/audit-logs', requireAuth, requireRole('admin'), listAuditLogController);
router.get('/audit-logs/verify', requireAuth, requireRole('admin'), verifyAuditChainController);

export default router;
