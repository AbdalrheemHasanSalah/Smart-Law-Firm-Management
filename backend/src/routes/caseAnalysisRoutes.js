import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { createTasksFromMinutes, listAnalyses, runAnalysis } from '../services/caseAnalysisService.js';

/** Case analysis tools, for office staff on cases they can open. Mounted under /cases. */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
// Each run calls a paid model; the monthly allowance is the real limit, this stops bursts.
const runLimit = createRateLimit({ maxRequests: 20 });

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/:caseId/analyses', ...staff, handle((request) => listAnalyses(request.user, request.params.caseId)));
router.post('/:caseId/analyses', runLimit, ...staff, handle((request) => runAnalysis(request.user, request.params.caseId, request.body), 201));
router.post(
  '/:caseId/analyses/:analysisId/tasks',
  ...staff,
  handle((request) => createTasksFromMinutes(request.user, request.params.caseId, request.params.analysisId, request.body), 201)
);

export default router;
