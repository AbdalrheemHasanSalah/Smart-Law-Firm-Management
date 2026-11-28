import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  acknowledgeNotice,
  listCaseNotices,
  listMyNotices,
  previewNotice,
  recordWhatsAppSent,
  sendNotice,
} from '../services/officialNoticeService.js';
import { pushSettings, subscribe, unsubscribe } from '../services/pushService.js';
import { dismissFile, listCaseIncoming, listMyFiles, moveToCase, readFile, uploadFile } from '../services/sharedFileService.js';

/**
 * The client portal's upgrades (phase 5):
 *
 *   /shared-files…                files a client sends the office, and chat attachments
 *   /cases/:caseId/incoming-files the client's files waiting on a case
 *   /push/…                       this device's push notifications
 *   /cases/:caseId/notices…       official notices on a case (staff)
 *   /notices/…                    the signed-in client's notices
 */
const router = Router();
const everyone = [requireAuth, requireRole(['admin', 'lawyer', 'assistant', 'client'])];
const staff = [requireAuth, requireRole(['admin', 'lawyer', 'assistant'])];
const client = [requireAuth, requireRole(['client'])];
const uploadLimit = createRateLimit({ maxRequests: 30 });
const noticeLimit = createRateLimit({ maxRequests: 30 });

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.post('/shared-files', uploadLimit, ...everyone, handle((request) => uploadFile(request.user, request), 201));
router.get('/shared-files/mine', ...client, handle((request) => listMyFiles(request.user)));
router.get('/shared-files/:fileId', ...everyone, async (request, response, next) => {
  try {
    const { buffer, mime, fileName } = await readFile(request.user, request.params.fileId);
    response.setHeader('Content-Type', mime);
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});
router.post('/shared-files/:fileId/move', ...staff, handle((request) => moveToCase(request.user, request.params.fileId, request.body)));
router.post('/shared-files/:fileId/dismiss', ...staff, handle((request) => dismissFile(request.user, request.params.fileId)));
router.get('/cases/:caseId/incoming-files', ...staff, handle((request) => listCaseIncoming(request.user, request.params.caseId)));

router.get('/push/settings', ...everyone, handle(() => pushSettings()));
router.post('/push/subscriptions', ...everyone, handle((request) => subscribe(request.user, request.body, request.headers['user-agent']), 201));
router.delete('/push/subscriptions', ...everyone, handle((request) => unsubscribe(request.user, request.body)));

router.get('/cases/:caseId/notices', ...staff, handle((request) => listCaseNotices(request.user, request.params.caseId)));
router.get('/cases/:caseId/notices/draft', ...staff, handle((request) => previewNotice(request.user, request.params.caseId, request.query)));
router.post('/cases/:caseId/notices', noticeLimit, ...staff, handle((request) => sendNotice(request.user, request.params.caseId, request.body), 201));
router.post(
  '/cases/:caseId/notices/:noticeId/whatsapp-sent',
  ...staff,
  handle((request) => recordWhatsAppSent(request.user, request.params.caseId, request.params.noticeId))
);
router.get('/notices/mine', ...client, handle((request) => listMyNotices(request.user)));
router.post('/notices/:noticeId/acknowledge', ...client, handle((request) => acknowledgeNotice(request.user, request.params.noticeId)));

export default router;
