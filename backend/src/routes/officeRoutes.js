import { Router } from 'express';
import {
  acceptInvitationController,
  clearOfficeController,
  createInvitationController,
  listInvitationsController,
  listMembershipsController,
  listPlatformOfficesController,
  previewInvitationController,
  registerOfficeController,
  reviewOfficeController,
  revokeInvitationController,
  selectOfficeController,
  updateAccountStatusController,
} from '../controllers/officeController.js';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const router = Router();
const registrationLimit = createRateLimit({ maxRequests: 10 });
const invitationLookupLimit = createRateLimit({ maxRequests: 30 });

// Office onboarding for the signed-in account (no office context required yet).
router.post('/offices', registrationLimit, requireAuth, registerOfficeController);
router.get('/offices/mine', requireAuth, listMembershipsController);
router.post('/session/office', requireAuth, selectOfficeController);
router.delete('/session/office', requireAuth, clearOfficeController);

// Invitations managed by the administrator of the active office.
router.get('/offices/current/invitations', requireAuth, requireRole('admin'), listInvitationsController);
router.post('/offices/current/invitations', requireAuth, requireRole('admin'), createInvitationController);
router.delete(
  '/offices/current/invitations/:invitationId',
  requireAuth,
  requireRole('admin'),
  revokeInvitationController
);

// Invitation links: public preview, authenticated acceptance.
router.get('/invitations/:token', invitationLookupLimit, previewInvitationController);
router.post('/invitations/:token/accept', invitationLookupLimit, requireAuth, acceptInvitationController);

// Platform administration of offices.
router.get('/platform/offices', requireAuth, requirePlatformAdmin, listPlatformOfficesController);
router.patch('/platform/offices/:officeId', requireAuth, requirePlatformAdmin, reviewOfficeController);
router.patch('/platform/users/:userId/status', requireAuth, requirePlatformAdmin, updateAccountStatusController);

export default router;
