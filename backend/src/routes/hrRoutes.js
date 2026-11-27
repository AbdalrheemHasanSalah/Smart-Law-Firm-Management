import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  cancelLeave,
  decideLeave,
  deletePayslip,
  generatePayroll,
  giveAdvance,
  listAdvances,
  listLeave,
  listPayslips,
  listStaff,
  myHr,
  payPayslip,
  requestLeave,
  saveStaffProfile,
  updatePayslip,
} from '../services/hrService.js';

/** Team HR under /hr: staff records, advances and payroll (administrator); leave and one's own record (everyone on staff). */
const router = Router();
const admin = [requireAuth, requireRole('admin')];
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/me', ...staff, handle((request) => myHr(request.user)));
router.get('/staff', ...admin, handle((request) => listStaff(request.user)));
router.put('/staff/:userId', ...admin, handle(async (request) => ({ staff: await saveStaffProfile(request.user, request.params.userId, request.body) })));

router.get('/advances', ...staff, handle((request) => listAdvances(request.user, request.query)));
router.post('/advances', ...admin, handle((request) => giveAdvance(request.user, request.body), 201));

router.get('/payslips', ...staff, handle((request) => listPayslips(request.user, request.query)));
router.post('/payroll', ...admin, handle((request) => generatePayroll(request.user, request.body), 201));
router.patch('/payslips/:payslipId', ...admin, handle(async (request) => ({ payslip: await updatePayslip(request.user, request.params.payslipId, request.body) })));
router.delete('/payslips/:payslipId', ...admin, handle((request) => deletePayslip(request.user, request.params.payslipId)));
router.post('/payslips/:payslipId/pay', ...admin, handle(async (request) => ({ payslip: await payPayslip(request.user, request.params.payslipId, request.body) })));

router.get('/leave', ...staff, handle((request) => listLeave(request.user, request.query)));
router.post('/leave', ...staff, handle((request) => requestLeave(request.user, request.body), 201));
router.post('/leave/:leaveId/decision', ...admin, handle((request) => decideLeave(request.user, request.params.leaveId, request.body)));
router.post('/leave/:leaveId/cancel', ...staff, handle((request) => cancelLeave(request.user, request.params.leaveId)));

export default router;
