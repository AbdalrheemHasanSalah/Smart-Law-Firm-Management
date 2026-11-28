import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { clientBriefcase } from '../services/briefcaseService.js';
import { changeStage, getCaseStage, setMizanNumber } from '../services/caseStageService.js';
import { createAgreement, listAgreements, settleAgreement } from '../services/feeAgreementService.js';

/**
 * Case workflow and the client briefcase (phase 6):
 *
 *   /cases/:caseId/stage            the stage, its history and the Mizan number
 *   /fee-agreements…                fee agreements and their installments (office admin)
 *   /clients/:clientId/briefcase    everything about one client
 */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const anyone = [requireAuth, requireRole(['admin', 'lawyer', 'assistant', 'client'])];
const admin = [requireAuth, requireRole(['admin'])];

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/cases/:caseId/stage', ...anyone, handle((request) => getCaseStage(request.user, request.params.caseId)));
router.put('/cases/:caseId/stage', ...staff, handle((request) => changeStage(request.user, request.params.caseId, request.body)));
router.put('/cases/:caseId/mizan', ...staff, handle((request) => setMizanNumber(request.user, request.params.caseId, request.body)));

router.get('/fee-agreements', ...admin, handle((request) => listAgreements(request.user, { caseId: request.query.caseId, clientId: request.query.clientId })));
router.post('/fee-agreements', ...admin, handle((request) => createAgreement(request.user, request.body), 201));
router.post('/fee-agreements/:agreementId/settle', ...admin, handle((request) => settleAgreement(request.user, request.params.agreementId, request.body)));

router.get('/clients/:clientId/briefcase', ...staff, handle((request) => clientBriefcase(request.user, request.params.clientId)));

export default router;
