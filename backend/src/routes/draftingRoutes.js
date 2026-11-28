import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  archiveTemplate,
  createDraft,
  createTemplate,
  deleteDraft,
  finalizeDraft,
  generateDraft,
  getDraft,
  listDrafts,
  listTemplates,
  revokeDraft,
  updateDraft,
  updateTemplate,
} from '../services/draftingService.js';
import {
  attachLetterheadLogo,
  getLetterhead,
  readLetterheadLogo,
  registerPrint,
  removeLetterheadLogo,
  saveLetterhead,
  verifyCode,
} from '../services/printService.js';

/**
 * Drafting and printing.
 *
 *   /letterhead                          the office letterhead (staff read, admin edits)
 *   /templates                           built-in skeletons and the office's templates
 *   /cases/:caseId/drafts                drafts on a case, AI drafting, finalize and revoke
 *   /prints                              register a print and get its verification code
 *   /public/verify/:code                 the public check behind a printed QR code
 */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const uploadLimit = createRateLimit({ maxRequests: 20 });
const aiLimit = createRateLimit({ maxRequests: 20 });
const verifyLimit = createRateLimit({ maxRequests: 60 });

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/letterhead', ...staff, handle((request) => getLetterhead(request.user)));
router.put('/letterhead', ...staff, handle((request) => saveLetterhead(request.user, request.body)));
router.put('/letterhead/logo', uploadLimit, ...staff, handle((request) => attachLetterheadLogo(request.user, request)));
router.delete('/letterhead/logo', ...staff, handle((request) => removeLetterheadLogo(request.user)));
router.get('/letterhead/logo', ...staff, async (request, response, next) => {
  try {
    const { buffer, mime } = await readLetterheadLogo(request.user);
    response.setHeader('Content-Type', mime);
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});

router.get('/templates', ...staff, handle((request) => listTemplates(request.user)));
router.post('/templates', ...staff, handle((request) => createTemplate(request.user, request.body), 201));
router.patch('/templates/:templateId', ...staff, handle((request) => updateTemplate(request.user, request.params.templateId, request.body)));
router.delete('/templates/:templateId', ...staff, handle((request) => archiveTemplate(request.user, request.params.templateId)));

router.get('/cases/:caseId/drafts', ...staff, handle((request) => listDrafts(request.user, request.params.caseId)));
router.post('/cases/:caseId/drafts', ...staff, handle((request) => createDraft(request.user, request.params.caseId, request.body), 201));
router.post('/cases/:caseId/drafts/generate', aiLimit, ...staff, handle((request) => generateDraft(request.user, request.params.caseId, request.body), 201));
router.get('/cases/:caseId/drafts/:draftId', ...staff, handle((request) => getDraft(request.user, request.params.caseId, request.params.draftId)));
router.patch('/cases/:caseId/drafts/:draftId', ...staff, handle((request) => updateDraft(request.user, request.params.caseId, request.params.draftId, request.body)));
router.delete('/cases/:caseId/drafts/:draftId', ...staff, handle((request) => deleteDraft(request.user, request.params.caseId, request.params.draftId)));
router.post('/cases/:caseId/drafts/:draftId/finalize', ...staff, handle((request) => finalizeDraft(request.user, request.params.caseId, request.params.draftId)));
router.post('/cases/:caseId/drafts/:draftId/revoke', ...staff, handle((request) => revokeDraft(request.user, request.params.caseId, request.params.draftId)));

router.post('/prints', ...staff, handle((request) => registerPrint(request.user, request.body), 201));
router.get('/public/verify/:code', verifyLimit, handle((request) => verifyCode(request.params.code)));

export default router;
