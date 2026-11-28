import { Router } from 'express';
import { requireAuth, requirePlatformAdmin, requireRole } from '../middleware/auth.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { backupStatus, exportOfficeData, listMemberSecurity, setMemberPermissions, unlockMember } from '../services/securityService.js';

/**
 * Security and roles (phase 8):
 *
 *   /offices/current/members/security          members' roles, permissions and sign-in locks (owner)
 *   /offices/current/members/:userId/…         change permissions, lift a lock (owner)
 *   /offices/current/export                    a verified export of the office's own data (owner)
 *   /platform/backups                          the nightly server backups and their checks
 */
const router = Router();
const owner = [requireAuth, requireRole(['admin'])];
const exportLimit = createRateLimit({ maxRequests: 5 });

const handle = (run, status = 200) => async (request, response, next) => {
  try {
    return response.status(status).json(await run(request));
  } catch (error) {
    return next(error);
  }
};

router.get('/offices/current/members/security', ...owner, handle((request) => listMemberSecurity(request.user)));
router.put('/offices/current/members/:userId/permissions', ...owner, handle((request) => setMemberPermissions(request.user, request.params.userId, request.body)));
router.post('/offices/current/members/:userId/unlock', ...owner, handle((request) => unlockMember(request.user, request.params.userId)));
router.get('/offices/current/export', exportLimit, ...owner, async (request, response, next) => {
  try {
    const result = await exportOfficeData(request.user);
    const day = result.manifest.exported_at.slice(0, 10);
    response.setHeader('Content-Disposition', `attachment; filename="qadiyati-office-export-${day}.json"`);
    response.setHeader('X-Export-SHA256', result.manifest.sha256);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});
router.get('/platform/backups', requireAuth, requirePlatformAdmin, handle((request) => backupStatus(request.user)));

export default router;
