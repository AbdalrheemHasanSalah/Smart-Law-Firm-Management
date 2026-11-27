import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  accountLedger,
  caseProfitability,
  createAccount,
  createTransfer,
  listAccounts,
  officeProfitability,
  updateAccount,
} from '../services/accountService.js';
import {
  attachExpenseReceipt,
  cancelExpense,
  createExpense,
  issueCustody,
  listCustodies,
  listExpenses,
  readExpenseReceipt,
  settleCustody,
} from '../services/expenseService.js';

/**
 * Office finance, under /finance: accounts, transfers, ledgers and profitability (administrator);
 * expenses and custodies (the administrator, and staff for the custodies they hold).
 */
const router = Router();
const admin = [requireAuth, requireRole('admin')];
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const uploadLimit = createRateLimit({ maxRequests: 20 });

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/accounts', ...admin, handle((request) => listAccounts(request.user)));
router.post('/accounts', ...admin, handle(async (request) => ({ account: await createAccount(request.user, request.body) }), 201));
router.patch('/accounts/:accountId', ...admin, handle(async (request) => ({ account: await updateAccount(request.user, request.params.accountId, request.body) })));
router.get('/accounts/:accountId/ledger', ...admin, handle((request) => accountLedger(request.user, request.params.accountId, request.query)));
router.post('/transfers', ...admin, handle((request) => createTransfer(request.user, request.body), 201));
router.get('/profitability', ...admin, handle((request) => officeProfitability(request.user, request.query)));
router.get('/cases/:caseId/profitability', ...admin, handle((request) => caseProfitability(request.user, request.params.caseId)));

router.get('/expenses', ...staff, handle((request) => listExpenses(request.user, request.query)));
router.post('/expenses', ...staff, handle(async (request) => ({ expense: await createExpense(request.user, request.body) }), 201));
router.post('/expenses/:expenseId/cancel', ...staff, handle(async (request) => ({ expense: await cancelExpense(request.user, request.params.expenseId) })));
router.put('/expenses/:expenseId/receipt', uploadLimit, ...staff, handle((request) => attachExpenseReceipt(request.user, request.params.expenseId, request)));
router.get('/expenses/:expenseId/receipt', ...staff, async (request, response, next) => {
  try {
    const { buffer, mime } = await readExpenseReceipt(request.user, request.params.expenseId);
    response.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.status(200).end(buffer);
  } catch (error) {
    return next(error);
  }
});

router.get('/custodies', ...staff, handle((request) => listCustodies(request.user, request.query)));
router.post('/custodies', ...admin, handle(async (request) => ({ custody: await issueCustody(request.user, request.body) }), 201));
router.post('/custodies/:custodyId/settle', ...admin, handle(async (request) => ({ custody: await settleCustody(request.user, request.params.custodyId, request.body) })));

export default router;
