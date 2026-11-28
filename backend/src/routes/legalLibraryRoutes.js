import { Router } from 'express';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  createPrinciple,
  getArticle,
  getGazetteIssue,
  getLaw,
  getRuling,
  libraryStats,
  libraryStatsForStaff,
  linkToCase,
  listCaseReferences,
  listGazette,
  listLaws,
  listPrinciples,
  listSavedItems,
  removePrinciple,
  removeSavedItem,
  saveItem,
  searchLibrary,
  unlinkFromCase,
  updatePrinciple,
  updateSavedItem,
} from '../services/legalLibraryService.js';
import { importLibrary, LegalImportError, listImports } from '../services/legalLibraryImport.js';

/**
 * The legal library. Office staff read it and keep their own saved items, principles and case
 * references under /library; the platform admin imports the shared texts under /platform/library.
 * The import route has its own larger body limit, set in app.js before the general JSON parser.
 */
const router = Router();
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const platform = [requireAuth, requirePlatformAdmin];
const searchLimit = createRateLimit({ maxRequests: 120 });

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/library/stats', ...staff, handle((request) => libraryStatsForStaff(request.user)));
router.get('/library/search', searchLimit, ...staff, handle((request) => searchLibrary(request.user, request.query)));
router.get('/library/laws', ...staff, handle((request) => listLaws(request.user, request.query)));
router.get('/library/laws/:lawId', ...staff, handle((request) => getLaw(request.user, request.params.lawId)));
router.get('/library/articles/:articleId', ...staff, handle((request) => getArticle(request.user, request.params.articleId)));
router.get('/library/rulings/:rulingId', ...staff, handle((request) => getRuling(request.user, request.params.rulingId)));
router.get('/library/gazette', ...staff, handle((request) => listGazette(request.user, request.query)));
router.get('/library/gazette/:issueId', ...staff, handle((request) => getGazetteIssue(request.user, request.params.issueId)));

router.get('/library/saved', ...staff, handle((request) => listSavedItems(request.user, request.query)));
router.post('/library/saved', ...staff, handle((request) => saveItem(request.user, request.body), 201));
router.patch('/library/saved/:itemId', ...staff, handle((request) => updateSavedItem(request.user, request.params.itemId, request.body)));
router.delete('/library/saved/:itemId', ...staff, handle((request) => removeSavedItem(request.user, request.params.itemId)));

router.get('/library/principles', ...staff, handle((request) => listPrinciples(request.user, request.query)));
router.post('/library/principles', ...staff, handle((request) => createPrinciple(request.user, request.body), 201));
router.patch('/library/principles/:principleId', ...staff, handle((request) => updatePrinciple(request.user, request.params.principleId, request.body)));
router.delete('/library/principles/:principleId', ...staff, handle((request) => removePrinciple(request.user, request.params.principleId)));

router.get('/library/cases/:caseId/references', ...staff, handle((request) => listCaseReferences(request.user, request.params.caseId)));
router.post('/library/cases/:caseId/references', ...staff, handle((request) => linkToCase(request.user, request.params.caseId, request.body), 201));
router.delete(
  '/library/cases/:caseId/references/:referenceId',
  ...staff,
  handle((request) => unlinkFromCase(request.user, request.params.caseId, request.params.referenceId))
);

router.get('/platform/library/stats', ...platform, handle(() => libraryStats()));
router.get('/platform/library/imports', ...platform, handle((request) => listImports(request.user)));
/** ?dryRun=true previews; the file name, when sent, is kept in the import history. */
router.post('/platform/library/import', ...platform, async (request, response, next) => {
  try {
    const fileName = typeof request.query.fileName === 'string' ? request.query.fileName.slice(0, 200) : null;
    const result = await importLibrary(request.user, request.body, { dryRun: request.query.dryRun === 'true', fileName });
    return response.status(200).json(result);
  } catch (error) {
    // The list of problems in the file is the point of the answer, so it is sent with the code.
    if (error instanceof LegalImportError && error.errors) {
      return response.status(error.status).json({ code: error.publicCode, error: error.message, errors: error.errors });
    }
    return next(error);
  }
});

export default router;
