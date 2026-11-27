import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { officeReport } from '../services/reportService.js';

/** Office reports: the administrator's whole office (or one member), and each member's own. */
const router = Router();

router.get('/', requireAuth, requireRole(['admin', 'lawyer', 'assistant']), async (request, response, next) => {
  try {
    return response.status(200).json(await officeReport(request.user, request.query));
  } catch (error) {
    return next(error);
  }
});

export default router;
