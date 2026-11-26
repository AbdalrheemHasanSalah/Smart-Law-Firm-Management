import { Router } from 'express';
import {
  cancelInvoiceController,
  clientStatementController,
  createInvoiceController,
  financeSummaryController,
  listInvoicesController,
  ownStatementController,
  recordPaymentController,
} from '../controllers/financeController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const staffRoles = ['admin', 'lawyer', 'assistant'];

router.get('/invoices', requireAuth, requireRole(staffRoles), listInvoicesController);
router.post('/invoices', requireAuth, requireRole('admin'), createInvoiceController);
router.post('/invoices/:invoiceId/payments', requireAuth, requireRole('admin'), recordPaymentController);
router.post('/invoices/:invoiceId/cancel', requireAuth, requireRole('admin'), cancelInvoiceController);
router.get('/summary', requireAuth, requireRole('admin'), financeSummaryController);
router.get('/statements/:clientId', requireAuth, requireRole('admin'), clientStatementController);
router.get('/statement', requireAuth, requireRole('client'), ownStatementController);

export default router;
