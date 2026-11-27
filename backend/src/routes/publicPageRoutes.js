import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { convertConsultation, listConsultations, submitConsultation, updateConsultation } from '../services/consultationService.js';
import { attachLogo, getOwnPublicPage, getPublishedPage, readPublishedLogo, savePublicPage } from '../services/publicPageService.js';

/**
 * The office's public page and its consultation requests.
 *
 *   /public/offices/:slug                  the published page, for anyone (no sign-in)
 *   /public/offices/:slug/consultations    a visitor's request, rate limited
 *   /offices/current/public-page           the administrator's page settings and logo
 *   /consultations                         the office's inbox of requests
 */
const router = Router();
const admin = [requireAuth, requireRole('admin')];
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const pageLimit = createRateLimit({ maxRequests: 120 });
const requestLimit = createRateLimit({ maxRequests: 5 });
const uploadLimit = createRateLimit({ maxRequests: 20 });

const handle = (work, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await work(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/public/offices/:slug', pageLimit, handle((request) => getPublishedPage(request.params.slug)));
router.get('/public/offices/:slug/logo', pageLimit, async (request, response, next) => {
  try {
    const { buffer, mime } = await readPublishedLogo(request.params.slug);
    response.set({
      'Content-Type': mime,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.status(200).end(buffer);
  } catch (error) {
    return next(error);
  }
});
router.post('/public/offices/:slug/consultations', requestLimit, handle(async (request) => {
  const { received } = await submitConsultation(request.params.slug, request.body);
  // Same answer whether it was kept or dropped as a bot.
  return { received };
}, 201));

router.get('/offices/current/public-page', ...admin, handle((request) => getOwnPublicPage(request.user)));
router.put('/offices/current/public-page', ...admin, handle((request) => savePublicPage(request.user, request.body)));
router.put('/offices/current/public-page/logo', uploadLimit, ...admin, handle((request) => attachLogo(request.user, request)));

router.get('/consultations', ...staff, handle((request) => listConsultations(request.user, request.query)));
router.patch('/consultations/:requestId', ...staff, handle((request) => updateConsultation(request.user, request.params.requestId, request.body)));
router.post('/consultations/:requestId/convert', ...admin, handle((request) => convertConsultation(request.user, request.params.requestId, request.body), 201));

export default router;
