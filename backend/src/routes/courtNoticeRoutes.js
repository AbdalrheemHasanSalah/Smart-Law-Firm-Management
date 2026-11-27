import { Router } from 'express';
import {
  attachCourtNoticeFileController,
  createCourtNoticeController,
  downloadCourtNoticeFileController,
  listCourtNoticesController,
  updateCourtNoticeController,
} from '../controllers/courtNoticeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

/** Court notices (bailiff papers): the administrator and the case team record and follow them. */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const uploadLimit = createRateLimit({ maxRequests: 20 });

router.get('/', ...staff, listCourtNoticesController);
router.post('/', ...staff, createCourtNoticeController);
router.get('/:noticeId/attachment', ...staff, downloadCourtNoticeFileController);
router.put('/:noticeId/attachment', uploadLimit, ...staff, attachCourtNoticeFileController);
router.patch('/:noticeId', ...staff, updateCourtNoticeController);

export default router;
