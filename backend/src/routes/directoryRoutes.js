import { Router } from 'express';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import {
  createColleague,
  createCourt,
  createTemplate,
  deleteColleague,
  deleteTemplate,
  listColleagues,
  listCourts,
  listTemplates,
  setCourtNote,
  updateColleague,
  updateCourt,
  updateTemplate,
} from '../services/directoryService.js';

/**
 * The professional directory (phase 7):
 *
 *   /courts                      the shared court list; the platform admin keeps it, offices add notes
 *   /colleagues                  the office's colleagues from other offices
 *   /colleague-templates         the office's own message templates to colleagues
 */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const admin = [requireAuth, requireRole(['admin'])];
const platform = [requireAuth, requirePlatformAdmin];

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

// Staff and the platform admin both read the list; the service tells them apart.
router.get('/courts', requireAuth, handle((request) => listCourts(request.user, { search: request.query.search })));
router.post('/courts', ...platform, handle((request) => createCourt(request.user, request.body), 201));
router.patch('/courts/:courtId', ...platform, handle((request) => updateCourt(request.user, request.params.courtId, request.body)));
router.put('/courts/:courtId/note', ...staff, handle((request) => setCourtNote(request.user, request.params.courtId, request.body)));

router.get('/colleagues', ...staff, handle((request) => listColleagues(request.user, { search: request.query.search })));
router.post('/colleagues', ...staff, handle((request) => createColleague(request.user, request.body), 201));
router.patch('/colleagues/:colleagueId', ...staff, handle((request) => updateColleague(request.user, request.params.colleagueId, request.body)));
router.delete('/colleagues/:colleagueId', ...admin, handle((request) => deleteColleague(request.user, request.params.colleagueId)));

router.get('/colleague-templates', ...staff, handle((request) => listTemplates(request.user)));
router.post('/colleague-templates', ...admin, handle((request) => createTemplate(request.user, request.body), 201));
router.patch('/colleague-templates/:templateId', ...admin, handle((request) => updateTemplate(request.user, request.params.templateId, request.body)));
router.delete('/colleague-templates/:templateId', ...admin, handle((request) => deleteTemplate(request.user, request.params.templateId)));

export default router;
